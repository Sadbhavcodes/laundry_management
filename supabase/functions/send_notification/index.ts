import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Notification types supported across the domain workflow
// Added 'ORDER_READY' (e.g. "Your laundry is done and ready for pickup!") and 'ORDER_PROCESSING'
export type NotificationType =
  | 'ORDER_CREATED'
  | 'SCHEDULE_CONFIRMED'
  | 'ORDER_PROCESSING'
  | 'ORDER_READY'
  | 'DELIVERY_CONFIRMED'
  | 'DELIVERY_EXCEPTION'

type NotificationRequest = { recipientId?: unknown; type?: unknown; message?: unknown; referenceId?: unknown }

type DispatchMessage = { recipient: string | null; type: NotificationType; message: string; referenceId: string }
interface NotificationProvider { dispatch(message: DispatchMessage): Promise<void> }

/**
 * MockNotificationProvider:
 * Simulates external Email/SMS notification delivery (e.g. SendGrid, Twilio, AWS SES).
 * In viva exam demonstration, explains the Gateway Pattern / boundary class (FR-029 / FR-030).
 */
class MockNotificationProvider implements NotificationProvider {
  async dispatch(message: DispatchMessage): Promise<void> {
    if (Deno.env.get('NOTIFICATION_MOCK_MODE') === 'failure') {
      throw new Error('Mock provider failure')
    }
    console.info(`[NotificationGateway/Email/SMS] Sent "${message.type}" to ${message.recipient || 'Customer'}: "${message.message}" (Order ID: ${message.referenceId})`)
  }
}

const notificationTypes: NotificationType[] = [
  'ORDER_CREATED',
  'SCHEDULE_CONFIRMED',
  'ORDER_PROCESSING',
  'ORDER_READY',
  'DELIVERY_CONFIRMED',
  'DELIVERY_EXCEPTION'
]
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
function response(body: unknown, headers: HeadersInit, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, headers, 405)

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey || request.headers.get('x-internal-notification-token') !== serviceRoleKey) {
    return response({ error: 'UNAUTHORIZED' }, headers, 401)
  }
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) return response({ error: 'GATEWAY_UNAVAILABLE' }, headers, 500)

  let body: NotificationRequest
  try { body = await request.json() as NotificationRequest } catch { return response({ error: 'INVALID_REQUEST' }, headers, 400) }
  if (!validUuid(body.recipientId) || !validUuid(body.referenceId)
    || typeof body.type !== 'string' || !notificationTypes.includes(body.type as NotificationType)
    || typeof body.message !== 'string' || !body.message.trim()) {
    return response({ error: 'INVALID_REQUEST' }, headers, 400)
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // Persist before provider dispatch. A failed dispatch remains visible and retryable.
  const { data: notification, error: insertError } = await admin.from('notifications').insert({
    recipient_id: body.recipientId,
    order_id: body.referenceId,
    notification_type: body.type,
    message: body.message.trim(),
    delivery_status: 'pending',
  }).select('id').single()
  if (insertError || !notification) return response({ error: 'PERSISTENCE_FAILED' }, headers, 500)

  let status: 'sent' | 'failed' = 'sent'
  try {
    const { data: profile } = await admin.from('profiles').select('contact_info').eq('id', body.recipientId).maybeSingle()
    const contact = profile?.contact_info as { email?: string; phone?: string } | null
    const provider: NotificationProvider = new MockNotificationProvider()
    await provider.dispatch({ recipient: contact?.email || contact?.phone || null, type: body.type as NotificationType, message: body.message.trim(), referenceId: body.referenceId })
  } catch (error) {
    status = 'failed'
    console.error('Notification provider dispatch failed; row retained for retry.', error)
  }

  const { error: updateError } = await admin.from('notifications').update({ delivery_status: status }).eq('id', notification.id)
  if (updateError) {
    console.error('Notification status update failed; pending row retained for retry.', updateError)
    return response({ success: true, notificationId: notification.id, status: 'pending', retryable: true }, headers)
  }
  return response({ success: true, notificationId: notification.id, status, retryable: status === 'failed' }, headers)
})
