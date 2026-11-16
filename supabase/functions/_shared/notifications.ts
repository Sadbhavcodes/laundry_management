/**
 * ============================================================================
 * notifications.ts — Shared Notification Dispatch Helper (FR-029, FR-030, BR-010)
 * 
 * VIVA EXAM EXPLANATION:
 * This module embodies the NotificationGateway Boundary & Fire-and-Forget Pattern:
 * 1. BR-010 Rule: An external SMS/Email provider failure MUST NEVER abort or roll back
 *    an already-committed database operation (e.g., Order creation, slot booking, delivery).
 * 2. EdgeRuntime.waitUntil: Keeps the asynchronous task alive in the background while
 *    allowing the main Edge Function to return an immediate HTTP 200 response to the client.
 * ============================================================================
 */

// Notification types supported across the domain workflow
// UC-003: ORDER_CREATED
// UC-005: SCHEDULE_CONFIRMED
// Staff Workflow: ORDER_READY (Ready for pickup/delivery), ORDER_PROCESSING (In Processing)
// UC-010: DELIVERY_CONFIRMED, DELIVERY_EXCEPTION
export type NotificationType = 
  | 'ORDER_CREATED' 
  | 'SCHEDULE_CONFIRMED' 
  | 'ORDER_PROCESSING'
  | 'ORDER_READY' 
  | 'DELIVERY_CONFIRMED' 
  | 'DELIVERY_EXCEPTION'

export type NotificationPayload = {
  recipientId: string
  type: NotificationType
  message: string
  referenceId: string
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

/**
 * Invokes the dedicated send_notification Edge Function with internal service-role token.
 */
async function invokeGateway(payload: NotificationPayload): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceRoleKey) return

    // Dispatches HTTP POST to send_notification gateway endpoint
    const task = fetch(`${url}/functions/v1/send_notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'x-internal-notification-token': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then(() => undefined).catch(() => undefined)
    
    // Background isolation: runs to completion independently without blocking caller
    EdgeRuntime.waitUntil(task)
  } catch {
    // BR-010: Gateway failures are completely isolated from already-committed business operations.
  }
}

/**
 * Public function called by Edge Functions to queue an email/SMS notification.
 */
export function queueNotification(payload: NotificationPayload): void {
  void invokeGateway(payload)
}
