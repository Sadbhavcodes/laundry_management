import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { queueNotification } from '../_shared/notifications.ts'

type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'ORDER_NOT_DELIVERABLE' | 'ITEMS_UNACCOUNTED' | 'INVALID_CONFIRMATION' | 'DELIVERY_RECORD_FAILED'
type ItemConfirmation = { itemId?: unknown; outcome?: unknown; notes?: unknown }
type RecordDeliveryBody = { orderId?: unknown; itemConfirmations?: unknown }

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
  if (!url || !anonKey) return fail('DELIVERY_RECORD_FAILED', headers, 500)

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return fail('UNAUTHENTICATED', headers, 401)
  const sessionId = tokenSessionId(authorization.slice('Bearer '.length))
  if (!sessionId) return fail('UNAUTHENTICATED', headers, 401)
  const { data: activeSession } = await supabase.from('session_log').select('id')
    .eq('session_id', sessionId).eq('user_id', authData.user.id).eq('active', true).maybeSingle()
  if (!activeSession) return fail('UNAUTHENTICATED', headers, 401)
  const { data: profile } = await supabase.from('profiles').select('role, account_status').eq('id', authData.user.id).maybeSingle()
  if (!profile || profile.role !== 'DeliveryPersonnel' || profile.account_status !== 'Active') return fail('FORBIDDEN', headers, 403)

  let body: RecordDeliveryBody
  try { body = await request.json() as RecordDeliveryBody } catch { return fail('INVALID_CONFIRMATION', headers, 400) }
  if (!validUuid(body.orderId) || !Array.isArray(body.itemConfirmations)) return fail('ITEMS_UNACCOUNTED', headers, 400)
  if (body.itemConfirmations.some((entry: ItemConfirmation) => !entry || !validUuid(entry.itemId))) return fail('INVALID_CONFIRMATION', headers, 400)
  const confirmations = body.itemConfirmations as ItemConfirmation[]
  const outcomes = ['received', 'missing', 'damaged', 'failed_delivery_attempt']
  if (confirmations.some(item => typeof item.outcome !== 'string' || !outcomes.includes(item.outcome))) {
    return fail('INVALID_CONFIRMATION', headers, 400)
  }
  if (confirmations.some(item => item.notes !== undefined && item.notes !== null && typeof item.notes !== 'string')) {
    return fail('INVALID_CONFIRMATION', headers, 400)
  }

  const { data: assignment } = await supabase.from('staff_assignments').select('id')
    .eq('order_id', body.orderId).eq('staff_id', authData.user.id)
    .eq('assignment_role', 'DeliveryPersonnel').eq('active', true).maybeSingle()
  if (!assignment) return fail('FORBIDDEN', headers, 403)
  const { data: order } = await supabase.from('orders').select('id, status, customer_id')
    .eq('id', body.orderId).maybeSingle()
  if (!order) return fail('FORBIDDEN', headers, 403)
  if (order.status !== 'Out for Delivery' && order.status !== 'Delivered') return fail('ORDER_NOT_DELIVERABLE', headers, 409)

  const { data, error } = await supabase.rpc('record_delivery', {
    p_order_id: body.orderId,
    p_item_confirmations: confirmations.map(item => ({
      itemId: item.itemId,
      outcome: item.outcome,
      notes: typeof item.notes === 'string' ? item.notes.trim() : null,
    })),
    p_personnel_id: authData.user.id,
  })
  if (error) return fail(error.code === '40001' || error.code === '40P01' ? 'ORDER_NOT_DELIVERABLE' : 'DELIVERY_RECORD_FAILED', headers, 409)
  if (data?.error) {
    const code = data.error as ErrorCode
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 409
    return fail(code, headers, status)
  }
  // =========================================================================
  // Viva Explanation / Code Walkthrough:
  // UC-010 Record Delivery (BR-006, BR-007, BR-010):
  // - BR-007: Every item must have an explicit outcome (received, missing, damaged, failed).
  // - If any item is missing or damaged, exceptions are logged & reviewFlag is set.
  // - Only when ALL items are confirmed received undamaged does status become Delivered,
  //   which triggers idempotent invoice generation (BR-006).
  // - Dispatches DELIVERY_CONFIRMED or DELIVERY_EXCEPTION notification.
  // =========================================================================
  if (data.status === 'Delivered' && !data.alreadyDelivered) {
    queueNotification({
      recipientId: order.customer_id,
      type: 'DELIVERY_CONFIRMED',
      message: 'Your laundry order has been successfully delivered! Thank you for using LaundryHub.',
      referenceId: body.orderId,
    })
  } else if (data.status === 'Exception Recorded / Review Required') {
    queueNotification({
      recipientId: order.customer_id,
      type: 'DELIVERY_EXCEPTION',
      message: 'A delivery exception was recorded for your order and is currently under review by our team.',
      referenceId: body.orderId,
    })
  }
  return response(data, headers)
})
