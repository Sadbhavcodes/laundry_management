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

async function invokeGateway(payload: NotificationPayload): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceRoleKey) return

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
    EdgeRuntime.waitUntil(task)
  } catch {
    // Gateway failures are isolated from the already committed business operation.
  }
}

export function queueNotification(payload: NotificationPayload): void {
  void invokeGateway(payload)
}
