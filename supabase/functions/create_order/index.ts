/**
 * ============================================================================
 * create_order/index.ts — Supabase Edge Function (UC-003 Create Order)
 * SRS Traceability: FR-006, FR-007, FR-010, FR-012, FR-029; BR-001, BR-002
 * 
 * VIVA EXAM EXPLANATION:
 * Implements IOrderService.createOrder() contract:
 * 1. Checks Preconditions (BR-001):
 *    - Authenticated session with active Customer profile (from session_log & profiles table).
 * 2. Validates Items (BR-002):
 *    - Validates order items (no empty order, valid quantity > 0, recognized service types).
 * 3. Atomic Database Execution:
 *    - Calls PostgreSQL RPC create_order_atomic(items, instructions).
 *    - Creates Order (status='Created') and OrderItems in 1 transaction.
 * 4. Dispatches Notification (FR-029 / BR-010):
 *    - Calls queueNotification via NotificationGateway (ORDER_CREATED).
 * ============================================================================
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { queueNotification } from '../_shared/notifications.ts'
import { validateCreateOrderItems } from '../_shared/create_order_validation.ts'

type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'EMPTY_ORDER' | 'INVALID_ITEM' | 'INVALID_QUANTITY' | 'ORDER_CREATION_FAILED'
type CreateOrderBody = { items?: unknown; handlingInstructions?: unknown }

function response(body: unknown, headers: HeadersInit, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
}
function fail(error: ErrorCode, headers: HeadersInit, status: number) { return response({ error }, headers, status) }

/**
 * Extracts session_id claim from JWT token to check against session_log.
 */
function tokenSessionId(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { session_id?: string }
    return claims.session_id || null
  } catch { return null }
}

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, headers, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return fail('UNAUTHENTICATED', headers, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return fail('ORDER_CREATION_FAILED', headers, 500)

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // BR-001: Verify Supabase Auth user, active session_log row, and active Customer profile
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return fail('UNAUTHENTICATED', headers, 401)
  const sessionId = tokenSessionId(authorization.slice('Bearer '.length))
  if (!sessionId) return fail('UNAUTHENTICATED', headers, 401)
  const { data: activeSession, error: sessionError } = await supabase
    .from('session_log').select('id').eq('session_id', sessionId).eq('user_id', authData.user.id).eq('active', true).maybeSingle()
  if (sessionError || !activeSession) return fail('UNAUTHENTICATED', headers, 401)
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role, account_status').eq('id', authData.user.id).maybeSingle()
  if (profileError || !profile || profile.role !== 'Customer' || profile.account_status !== 'Active') {
    return fail('FORBIDDEN', headers, 403)
  }

  // =========================================================================
  // Viva Explanation / Code Walkthrough:
  // Preconditions checked above (BR-001):
  // 1. Session token must be valid and linked to active session_log.
  // 2. Caller profile role must be 'Customer' and account status 'Active'.
  // Postconditions (UC-003 / BR-002 / FR-029):
  // 1. Atomic RPC call create_order_atomic creates Order and OrderItems.
  // 2. Asynchronous notification queued via NotificationGateway boundary (FR-029).
  // =========================================================================

  let body: CreateOrderBody
  try { body = await request.json() as CreateOrderBody } catch { return fail('INVALID_ITEM', headers, 400) }
  const validation = validateCreateOrderItems(body.items)
  if ('error' in validation) return fail(validation.error, headers, 400)

  // Atomic database transaction via PostgreSQL stored procedure (BR-002)
  const { data, error } = await supabase.rpc('create_order_atomic', {
    p_items: validation.items,
    p_handling_instructions: typeof body.handlingInstructions === 'string' ? body.handlingInstructions.trim() : null,
  })
  if (error) return fail('ORDER_CREATION_FAILED', headers, 500)
  if (data?.error) {
    const code = data.error as ErrorCode
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 400
    return fail(code, headers, status)
  }

  // FR-029 Notification: Email/SMS notification dispatched via NotificationGateway
  // Uses fire-and-forget (isolated via EdgeRuntime.waitUntil) so notification failure never rolls back order creation.
  queueNotification({
    recipientId: authData.user.id,
    type: 'ORDER_CREATED',
    message: 'Your laundry order has been created successfully. Next step: Schedule pickup & delivery.',
    referenceId: data.orderId,
  })
  return response(data, headers)
})
