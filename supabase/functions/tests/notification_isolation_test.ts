import { queueNotification } from '../_shared/notifications.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`)
}

Deno.test('gateway dispatch failure is swallowed after the business RPC has returned', async () => {
  const previousUrl = Deno.env.get('SUPABASE_URL')
  const previousKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const previousFetch = globalThis.fetch
  const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }
  const previousRuntime = runtime.EdgeRuntime
  let pending: Promise<unknown> | undefined
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
  runtime.EdgeRuntime = { waitUntil: promise => { pending = promise } }
  globalThis.fetch = (() => Promise.reject(new Error('mock provider/network failure'))) as typeof fetch
  try {
    // queueNotification is deliberately void/non-blocking; the caller's committed RPC result is independent.
    assertEquals(queueNotification({
      recipientId: '00000000-0000-4000-8000-000000000001', type: 'ORDER_CREATED',
      message: 'Order created', referenceId: '00000000-0000-4000-8000-000000000002',
    }), undefined)
    assert(pending, 'EdgeRuntime.waitUntil should receive the isolated dispatch task')
    await pending
  } finally {
    globalThis.fetch = previousFetch
    if (previousRuntime) runtime.EdgeRuntime = previousRuntime
    else delete runtime.EdgeRuntime
    if (previousUrl) Deno.env.set('SUPABASE_URL', previousUrl)
    else Deno.env.delete('SUPABASE_URL')
    if (previousKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previousKey)
    else Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  }
})
