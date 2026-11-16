import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { queueNotification } from '../_shared/notifications.ts'

type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'SLOT_UNAVAILABLE' | 'ORDER_NOT_SCHEDULABLE' | 'CONCURRENT_UPDATE'
type ScheduleBody = { orderId?: unknown; pickupSlotId?: unknown; deliverySlotId?: unknown }

function response(body: unknown, headers: HeadersInit, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
}
function fail(error: ErrorCode, headers: HeadersInit, status: number) { return response({ error }, headers, status) }
function tokenSessionId(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { session_id?: string }
    return claims.session_id || null
  } catch { return null }
}
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, headers, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return fail('UNAUTHENTICATED', headers, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return fail('CONCURRENT_UPDATE', headers, 500)
  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return fail('UNAUTHENTICATED', headers, 401)
  const sessionId = tokenSessionId(authorization.slice('Bearer '.length))
  if (!sessionId) return fail('UNAUTHENTICATED', headers, 401)
  const { data: activeSession } = await supabase.from('session_log').select('id').eq('session_id', sessionId).eq('user_id', authData.user.id).eq('active', true).maybeSingle()
  if (!activeSession) return fail('UNAUTHENTICATED', headers, 401)
  const { data: profile } = await supabase.from('profiles').select('role, account_status').eq('id', authData.user.id).maybeSingle()
  if (!profile || profile.role !== 'Customer' || profile.account_status !== 'Active') return fail('FORBIDDEN', headers, 403)

  let body: ScheduleBody
  try { body = await request.json() as ScheduleBody } catch { return fail('ORDER_NOT_SCHEDULABLE', headers, 400) }
  if (!validUuid(body.orderId) || !validUuid(body.pickupSlotId) || !validUuid(body.deliverySlotId)) return fail('ORDER_NOT_SCHEDULABLE', headers, 400)

  const { data: order } = await supabase.from('orders').select('id, status').eq('id', body.orderId).eq('customer_id', authData.user.id).maybeSingle()
  if (!order) return fail('FORBIDDEN', headers, 403)
  if (order.status !== 'Created') return fail('ORDER_NOT_SCHEDULABLE', headers, 409)

  // =========================================================================
  // Viva Explanation / Code Walkthrough:
  // UC-005 Schedule Pickup/Delivery & BR-003 Dual-Slot Invariant:
  // - PostgreSQL RPC schedule_order executes SELECT ... FOR UPDATE on both slots.
  // - Either BOTH pickup & delivery slots are successfully reserved, or NEITHER is.
  // - On success, queueNotification notifies the customer via Email/SMS.
  // =========================================================================
  const { data, error } = await supabase.rpc('schedule_order', {
    p_order_id: body.orderId, p_pickup_slot_id: body.pickupSlotId, p_delivery_slot_id: body.deliverySlotId,
  })
  if (error) {
    const concurrent = error.code === '40001' || error.code === '40P01'
    return fail(concurrent ? 'CONCURRENT_UPDATE' : 'SLOT_UNAVAILABLE', headers, concurrent ? 409 : 400)
  }
  if (data?.error) {
    const code = data.error as ErrorCode
    return fail(code, headers, code === 'FORBIDDEN' ? 403 : 409)
  }

  // FR-030 Status notification
  queueNotification({
    recipientId: authData.user.id,
    type: 'SCHEDULE_CONFIRMED',
    message: 'Your laundry pickup and delivery slots are confirmed! Our team will arrive at the scheduled pickup time.',
    referenceId: body.orderId,
  })
  return response(data, headers)
})
