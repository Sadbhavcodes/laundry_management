import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseSetupError } from './lib/supabase'
import './App.css'
import './Phase6.css'

type Role = 'Customer' | 'LaundryStaff' | 'DeliveryPersonnel' | 'Administrator'
type Profile = { id: string; name: string; role: Role; account_status: string }
type OrderItemDraft = { description: string; quantity: string; serviceType: string }
type CreateOrderSuccess = { orderId: string; status: 'Created'; estimatedPrice: number }
type CreateOrderResult = CreateOrderSuccess | { error: string }
type CreatedOrder = { id: string; created_at: string; estimated_price: number }
type Slot = { id: string; slot_start: string; slot_end: string; capacity: number; booked_count: number; slot_type: 'Pickup' | 'Delivery' }
type ScheduleSuccess = { orderId: string; pickupSlotId: string; deliverySlotId: string; status: 'Pickup Scheduled' }
type ScheduleResult = ScheduleSuccess | { error: string }
type DeliveryOrder = { id: string; status: string; customer_id: string }
type DeliveryItem = { id: string; description: string; service_type: string; quantity: number; unit_price: number }
type DeliveryOutcome = '' | 'received' | 'missing' | 'damaged' | 'failed_delivery_attempt'
type DeliveryExceptionDetail = { id: string; itemId: string | null; type: string; notes: string | null }
type DeliverySuccess = { orderId: string; status: 'Delivered'; invoice: { id: string; invoiceNumber: string; amount: number; issuedAt: string }; alreadyDelivered?: boolean }
type DeliveryExceptionResult = { orderId: string; status: 'Exception Recorded / Review Required'; exceptions: DeliveryExceptionDetail[] }
type DeliveryResult = DeliverySuccess | DeliveryExceptionResult | { error: string }
type StaffOrder = { id: string; status: string; estimated_price: number; created_at: string }
type StaffOrderItem = { id: string; description: string; quantity: number; item_status: string | null }
type ProcessingIssue = { id: string; order_item_id: string | null; note: string; created_at: string; resolved: boolean }
type CustomerTrackedOrder = { id: string; status: string; estimated_price: number; created_at: string; updated_at: string }
type InvoiceRow = { amount: number }
// FR-029 / FR-030 Customer notification model
type NotificationRow = {
  id: string
  order_id: string | null
  notification_type: string
  message: string
  delivery_status: 'pending' | 'sent' | 'failed'
  created_at: string
  read_at: string | null
}
const servicePrices: Record<string, number> = { 'Wash & Fold': 5, 'Dry Cleaning': 12, Pressing: 4, Delicates: 7.5 }

function sessionIdFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { session_id?: string }
    return claims.session_id || null
  } catch { return null }
}

const roleCopy: Record<Role, { title: string; description: string }> = {
  Customer: { title: 'Your laundry, on your schedule', description: 'Create an order and follow its pickup, care, and delivery.' },
  LaundryStaff: { title: 'Laundry operations', description: 'View the orders assigned to your station.' },
  DeliveryPersonnel: { title: 'Delivery route', description: 'View only the orders assigned to you.' },
  Administrator: { title: 'LaundryHub administration', description: 'Manage people, orders, capacity, and operations.' },
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const load = async (currentSession: Session | null) => {
      setSession(currentSession)
      if (!currentSession) { setProfile(null); setLoading(false); return }
      const sessionId = sessionIdFromToken(currentSession.access_token)
      if (sessionId) {
        await client.from('session_log').upsert({
          user_id: currentSession.user.id,
          session_id: sessionId,
          login_time: new Date().toISOString(),
          active: true,
          logout_time: null,
        }, { onConflict: 'session_id' })
      }
      const { data } = await client.from('profiles').select('id, name, role, account_status').eq('id', currentSession.user.id).single()
      setProfile(data as Profile | null); setLoading(false)
    }
    void client.auth.getSession().then(({ data }) => load(data.session))
    const { data: listener } = client.auth.onAuthStateChange((_event, currentSession) => { void load(currentSession) })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (supabaseSetupError) return <SetupNotice message={supabaseSetupError} />
  if (loading) return <main className="page centered"><p>Loading your LaundryHub account…</p></main>
  if (!session) return <AuthCard />
  if (!profile) return <SetupNotice message="Your account exists, but its profile is unavailable. Please contact an administrator." />
  if (profile.account_status !== 'Active') return <SetupNotice message="This account is not active. Please contact an administrator." />
  return <ProtectedHome profile={profile} />
}

function AuthCard() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setMessage('')
    const result = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { data: { name } } })
    setBusy(false); setMessage(result.error ? result.error.message : mode === 'signup' ? 'Account created. You can now sign in.' : '')
  }
  return <main className="page auth-page"><section className="brand-panel"><span className="eyebrow">LaundryHub</span><h1>Care, tracked from door to door.</h1><p>One secure place for your laundry orders, schedules, and updates.</p></section><section className="auth-card" aria-labelledby="auth-title"><div className="tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button></div><h2 id="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your customer account'}</h2><p className="muted">{mode === 'login' ? 'Use the email and password associated with your account.' : 'New accounts start as Customer accounts. Staff roles are assigned by an administrator.'}</p><form onSubmit={submit}>{mode === 'signup' && <label>Full name<input value={name} onChange={e => setName(e.target.value)} required autoComplete="name" /></label>}<label>Email<input value={email} onChange={e => setEmail(e.target.value)} required type="email" autoComplete="email" /></label><label>Password<input value={password} onChange={e => setPassword(e.target.value)} required minLength={6} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>{message && <p className="form-message" role="status">{message}</p>}<button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form><p className="hint">Local demo: customer@laundryhub.test / Password123!</p></section></main>
}

function ProtectedHome({ profile }: { profile: Profile }) {
  const copy = roleCopy[profile.role]
  const guard = profile.role === 'Customer' ? 'You can access only your orders and their items.' : profile.role === 'LaundryStaff' ? 'You can access only orders assigned to you.' : profile.role === 'DeliveryPersonnel' ? 'You can access only orders and items with your active assignment.' : 'You have administrative access to all LaundryHub records.'
  async function signOut() {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const sessionId = data.session ? sessionIdFromToken(data.session.access_token) : null
    if (sessionId) await supabase.from('session_log').update({ active: false, logout_time: new Date().toISOString() }).eq('session_id', sessionId)
    await supabase.auth.signOut()
  }
  return <main className="page dashboard"><header><div><span className="eyebrow">LaundryHub</span><h1>{copy.title}</h1></div><div className="account"><span>{profile.name}</span><strong>{profile.role}</strong><button onClick={() => void signOut()}>Sign out</button></div></header><section className="welcome-card"><p className="eyebrow">Signed in securely</p><h2>Hello, {profile.name.split(' ')[0]}.</h2><p>{copy.description}</p></section>{profile.role === 'Customer' && <><CustomerNotifications customerId={profile.id} /><CreateOrderForm /><ScheduleOrderForm /><CustomerOrderTracker customerId={profile.id} /></>}{profile.role === 'LaundryStaff' && <StaffWorkflow staffId={profile.id} />} {profile.role === 'DeliveryPersonnel' && <RecordDeliveryScreen personnelId={profile.id} />}{profile.role === 'Administrator' && <AdminDashboard />}<section className="guard-card"><h2>Role-aware access is on</h2><p>{guard}</p></section></main>
}

export function CreateOrderForm() {
  const [items, setItems] = useState<OrderItemDraft[]>([{ description: '', quantity: '1', serviceType: 'Wash & Fold' }])
  const [handlingInstructions, setHandlingInstructions] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<CreateOrderSuccess | null>(null)
  const [busy, setBusy] = useState(false)
  const estimatedPrice = items.reduce((sum, item) => sum + (Number.parseInt(item.quantity, 10) || 0) * (servicePrices[item.serviceType] || 0), 0)
  const messages: Record<string, string> = {
    UNAUTHENTICATED: 'Your session has expired. Sign in again to place this order.',
    FORBIDDEN: 'Only an active customer account can place an order.',
    EMPTY_ORDER: 'Add at least one item before submitting your order.',
    INVALID_ITEM: 'Each item needs a description and a supported service type.',
    INVALID_QUANTITY: 'Enter a whole number greater than zero for every quantity.',
    ORDER_CREATION_FAILED: 'We could not save this order. Please try again.',
  }
  function updateItem(index: number, patch: Partial<OrderItemDraft>) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setError(''); setSuccess(null)
    const payloadItems = items.map(item => ({ description: item.description, quantity: Number(item.quantity), serviceType: item.serviceType }))
    const { data, error: invokeError } = await supabase.functions.invoke<CreateOrderResult>('create_order', { body: { items: payloadItems, handlingInstructions } })
    setBusy(false)
    if (invokeError) {
      const responseContext = invokeError.context as Response | undefined
      let code = 'ORDER_CREATION_FAILED'
      try { code = (await responseContext?.clone().json())?.error || code } catch { /* use the safe fallback */ }
      setError(messages[code] || messages.ORDER_CREATION_FAILED)
      return
    }
    if (!data) { setError(messages.ORDER_CREATION_FAILED); return }
    if ('error' in data) { setError(messages[data.error] || messages.ORDER_CREATION_FAILED); return }
    setSuccess(data); setItems([{ description: '', quantity: '1', serviceType: 'Wash & Fold' }]); setHandlingInstructions('')
  }
  return <section className="order-card" aria-labelledby="create-order-title">
    <div className="order-heading"><div><p className="eyebrow">New request</p><h2 id="create-order-title">Create a laundry order</h2></div><span className="price-pill">Estimate <strong>${estimatedPrice.toFixed(2)}</strong></span></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <p className="inline-success" role="status">Order created · {success.orderId.slice(0, 8)} · ${Number(success.estimatedPrice).toFixed(2)} estimated</p>}
    <form onSubmit={submit}>
      {items.map((item, index) => <div className="item-row" key={index}>
        <label className="item-description">Item description<input value={item.description} onChange={event => updateItem(index, { description: event.target.value })} placeholder="e.g. cotton shirts" required /></label>
        <label>Quantity<input value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} type="number" min="1" step="1" required /></label>
        <label>Service type<select value={item.serviceType} onChange={event => updateItem(index, { serviceType: event.target.value })}><option>Wash &amp; Fold</option><option>Dry Cleaning</option><option>Pressing</option><option>Delicates</option></select></label>
        {items.length > 1 && <button className="remove-item" type="button" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove item ${index + 1}`}>Remove</button>}
      </div>)}
      <button className="add-item" type="button" onClick={() => setItems(current => [...current, { description: '', quantity: '1', serviceType: 'Wash & Fold' }])}>＋ Add another item</button>
      <label className="instructions">Handling instructions <span>(optional)</span><textarea value={handlingInstructions} onChange={event => setHandlingInstructions(event.target.value)} placeholder="Anything we should know about these items?" rows={3} /></label>
      <div className="submit-row"><p>Final pricing may change after item review.</p><button className="primary submit-order" disabled={busy}>{busy ? 'Submitting…' : 'Submit order'}</button></div>
    </form>
  </section>
}

function ScheduleOrderForm() {
  const [orders, setOrders] = useState<CreatedOrder[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [orderId, setOrderId] = useState('')
  const [pickupSlotId, setPickupSlotId] = useState('')
  const [deliverySlotId, setDeliverySlotId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<ScheduleSuccess | null>(null)
  const loadChoices = async () => {
    if (!supabase) return
    setLoading(true)
    const [{ data: orderData }, { data: slotData }] = await Promise.all([
      supabase.from('orders').select('id, created_at, estimated_price').eq('status', 'Created').order('created_at', { ascending: false }),
      supabase.from('pickup_delivery_slots').select('id, slot_start, slot_end, capacity, booked_count, slot_type').eq('active', true).order('slot_start'),
    ])
    setOrders((orderData || []) as CreatedOrder[])
    setSlots(((slotData || []) as Slot[]).filter(slot => slot.booked_count < slot.capacity))
    setLoading(false)
  }
  useEffect(() => { void Promise.resolve().then(loadChoices) }, [])
  const pickupSlots = slots.filter(slot => slot.slot_type === 'Pickup')
  const deliverySlots = slots.filter(slot => slot.slot_type === 'Delivery')
  const displaySlot = (slot: Slot) => `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(slot.slot_start))} · ${slot.capacity - slot.booked_count} remaining`
  const messages: Record<string, string> = {
    UNAUTHENTICATED: 'Your session has expired. Sign in again before scheduling.',
    FORBIDDEN: 'You can schedule only your own customer orders.',
    ORDER_NOT_SCHEDULABLE: 'This order is no longer in the Created state. Refresh the choices and try another order.',
    SLOT_UNAVAILABLE: 'One of those slots just became unavailable. Pick another pair and try again.',
    CONCURRENT_UPDATE: 'Another update happened at the same time. Your order was not scheduled; refresh and try again.',
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setError(''); setSuccess(null)
    const { data, error: invokeError } = await supabase.functions.invoke<ScheduleResult>('schedule', { body: { orderId, pickupSlotId, deliverySlotId } })
    setBusy(false)
    if (invokeError) {
      let code = 'CONCURRENT_UPDATE'
      try { code = (await (invokeError.context as Response | undefined)?.clone().json())?.error || code } catch { /* use fallback */ }
      setError(messages[code] || messages.CONCURRENT_UPDATE); await loadChoices(); return
    }
    if (!data) { setError(messages.CONCURRENT_UPDATE); return }
    if ('error' in data) { setError(messages[data.error] || messages.CONCURRENT_UPDATE); await loadChoices(); return }
    setSuccess(data); setOrderId(''); setPickupSlotId(''); setDeliverySlotId(''); await loadChoices()
  }
  return <section className="schedule-card" aria-labelledby="schedule-title">
    <div className="order-heading"><div><p className="eyebrow">Pickup and delivery</p><h2 id="schedule-title">Schedule your order</h2></div><button className="refresh-button" type="button" onClick={() => void loadChoices()} disabled={loading}>Refresh availability</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <p className="inline-success" role="status">Both slots are confirmed. Your order is now Pickup Scheduled.</p>}
    {loading ? <p className="muted">Loading current availability…</p> : orders.length === 0 ? <p className="muted">There are no Created orders ready to schedule.</p> : <form onSubmit={submit} className="schedule-form">
      <label>Order<select value={orderId} onChange={event => setOrderId(event.target.value)} required><option value="" disabled>Select a Created order</option>{orders.map(order => <option key={order.id} value={order.id}>Order {order.id.slice(0, 8)} · ${Number(order.estimated_price).toFixed(2)}</option>)}</select></label>
      <div className="slot-columns"><SlotPicker title="Pickup slot" slots={pickupSlots} selectedId={pickupSlotId} onSelect={setPickupSlotId} describe={displaySlot} /><SlotPicker title="Delivery slot" slots={deliverySlots} selectedId={deliverySlotId} onSelect={setDeliverySlotId} describe={displaySlot} /></div>
      <div className="submit-row"><p>Capacity is rechecked when you confirm both slots.</p><button className="primary submit-order" disabled={busy || !orderId || !pickupSlotId || !deliverySlotId}>{busy ? 'Confirming…' : 'Confirm both slots'}</button></div>
    </form>}
  </section>
}

function SlotPicker({ title, slots, selectedId, onSelect, describe }: { title: string; slots: Slot[]; selectedId: string; onSelect: (id: string) => void; describe: (slot: Slot) => string }) {
  return <fieldset className="slot-picker"><legend>{title}</legend>{slots.length === 0 ? <p className="muted">No slots currently available.</p> : slots.map(slot => <label className={`slot-choice ${selectedId === slot.id ? 'selected' : ''}`} key={slot.id}><input type="radio" name={title} value={slot.id} checked={selectedId === slot.id} onChange={() => onSelect(slot.id)} required /><span>{describe(slot)}</span></label>)}</fieldset>
}

function RecordDeliveryScreen({ personnelId }: { personnelId: string }) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [items, setItems] = useState<DeliveryItem[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, DeliveryOutcome>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<DeliverySuccess | null>(null)
  const [exceptions, setExceptions] = useState<DeliveryExceptionDetail[] | null>(null)

  const loadOrders = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data: assignmentRows } = await supabase.from('staff_assignments').select('order_id')
      .eq('staff_id', personnelId).eq('assignment_role', 'DeliveryPersonnel').eq('active', true)
    const orderIds = [...new Set((assignmentRows || []).map(row => row.order_id))]
    if (orderIds.length === 0) { setOrders([]); setSelectedOrderId(''); setLoading(false); return }
    const { data } = await supabase.from('orders').select('id, status, customer_id').in('id', orderIds)
      .in('status', ['Out for Delivery', 'Delivered']).order('updated_at', { ascending: false })
    const available = (data || []) as DeliveryOrder[]
    setOrders(available)
    setSelectedOrderId(current => available.some(order => order.id === current) ? current : available[0]?.id || '')
    setLoading(false)
  }, [personnelId])
  const loadItems = useCallback(async (targetOrderId: string) => {
    if (!supabase || !targetOrderId) { setItems([]); return }
    const { data } = await supabase.from('order_items').select('id, description, service_type, quantity, unit_price')
      .eq('order_id', targetOrderId).order('created_at')
    const nextItems = (data || []) as DeliveryItem[]
    setItems(nextItems)
    setOutcomes(current => Object.fromEntries(nextItems.map(item => [item.id, current[item.id] || ''])))
    setNotes(current => Object.fromEntries(nextItems.map(item => [item.id, current[item.id] || ''])))
  }, [])
  useEffect(() => { void Promise.resolve().then(loadOrders) }, [loadOrders])
  useEffect(() => { void Promise.resolve().then(() => loadItems(selectedOrderId)) }, [loadItems, selectedOrderId])
  const errorMessages: Record<string, string> = {
    UNAUTHENTICATED: 'Your session is no longer active. Sign in again to record delivery.',
    FORBIDDEN: 'This order is not actively assigned to your delivery account.',
    ORDER_NOT_DELIVERABLE: 'This order is not ready to be recorded as delivered.',
    ITEMS_UNACCOUNTED: 'Choose an outcome for every item before submitting.',
    INVALID_CONFIRMATION: 'One of the item outcomes is invalid. Review the checklist and try again.',
    DELIVERY_RECORD_FAILED: 'We could not save the delivery record. Please try again.',
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setError(''); setSuccess(null); setExceptions(null)
    const itemConfirmations = items.map(item => ({ itemId: item.id, outcome: outcomes[item.id], notes: notes[item.id] || undefined }))
    const { data, error: invokeError } = await supabase.functions.invoke<DeliveryResult>('record_delivery', {
      body: { orderId: selectedOrderId, itemConfirmations },
    })
    setBusy(false)
    if (invokeError) {
      let code = 'DELIVERY_RECORD_FAILED'
      try { code = (await (invokeError.context as Response | undefined)?.clone().json())?.error || code } catch { /* use fallback */ }
      setError(errorMessages[code] || errorMessages.DELIVERY_RECORD_FAILED); return
    }
    if (!data) { setError(errorMessages.DELIVERY_RECORD_FAILED); return }
    if ('error' in data) { setError(errorMessages[data.error] || errorMessages.DELIVERY_RECORD_FAILED); return }
    if (data.status === 'Delivered') { setSuccess(data); await loadOrders(); return }
    setExceptions(data.exceptions); await loadOrders()
  }
  function updateOutcome(itemId: string, outcome: DeliveryOutcome) {
    setOutcomes(current => ({ ...current, [itemId]: outcome }))
  }
  return <section className="delivery-card" aria-labelledby="delivery-title">
    <div className="order-heading"><div><p className="eyebrow">Assigned route</p><h2 id="delivery-title">Record delivery</h2></div><button className="refresh-button" type="button" onClick={() => void loadOrders()} disabled={loading}>Refresh orders</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <div className="delivery-result success-result" role="status"><h3>Delivered</h3><p>Invoice {success.invoice.invoiceNumber} · ${Number(success.invoice.amount).toFixed(2)}</p>{success.alreadyDelivered && <small>This order was already delivered; the existing invoice was returned.</small>}</div>}
    {exceptions && <div className="delivery-result exception-result" role="status"><h3>Exception Recorded / Review Required</h3><p>Order status remains unchanged until the exceptions are reviewed.</p><ul>{exceptions.map(exception => <li key={exception.id}><strong>{exception.type}</strong>{exception.itemId && <> · {items.find(item => item.id === exception.itemId)?.description || 'Order item'}</>}{exception.notes && <> — {exception.notes}</>}</li>)}</ul></div>}
    {loading ? <p className="muted">Loading assigned deliveries…</p> : orders.length === 0 ? <p className="muted">No assigned orders are ready for delivery recording.</p> : <form className="delivery-form" onSubmit={submit}>
      <label>Assigned order<select value={selectedOrderId} onChange={event => { setSuccess(null); setExceptions(null); setSelectedOrderId(event.target.value) }} required>{orders.map(order => <option key={order.id} value={order.id}>Order {order.id.slice(0, 8)} · {order.status}</option>)}</select></label>
      {items.length === 0 ? <p className="inline-error">This order has no items to confirm. Contact an administrator before completing delivery.</p> : <>
        <div className="delivery-checklist"><div className="checklist-heading"><span>Item</span><span>Qty</span><span>Outcome</span></div>{items.map(item => <div className="delivery-item" key={item.id}>
          <div><strong>{item.description}</strong><small>{item.service_type}</small></div><span>{item.quantity}</span>
          <label className="outcome-field"><span className="sr-only">Outcome for {item.description}</span><select value={outcomes[item.id] || ''} onChange={event => updateOutcome(item.id, event.target.value as DeliveryOutcome)} required><option value="" disabled>Select outcome</option><option value="received">Received and undamaged</option><option value="missing">Missing item</option><option value="damaged">Damaged item</option><option value="failed_delivery_attempt">Failed delivery attempt</option></select></label>
          {outcomes[item.id] && outcomes[item.id] !== 'received' && <label className="exception-note">Exception notes <span>(optional)</span><input value={notes[item.id] || ''} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Add a short detail" /></label>}
        </div>)}</div>
        <div className="submit-row"><p>Every item needs an outcome. Exceptions require review and keep the order from being marked Delivered.</p><button className="primary submit-order" disabled={busy || items.some(item => !outcomes[item.id])}>{busy ? 'Saving delivery…' : 'Submit delivery record'}</button></div>
      </>}
    </form>}
  </section>
}

function StaffWorkflow({ staffId }: { staffId: string }) {
  const [orders, setOrders] = useState<StaffOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [items, setItems] = useState<StaffOrderItem[]>([])
  const [issues, setIssues] = useState<ProcessingIssue[]>([])
  const [issueItemId, setIssueItemId] = useState('')
  const [issueNote, setIssueNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data: assignments } = await supabase.from('staff_assignments').select('order_id')
      .eq('staff_id', staffId).eq('assignment_role', 'LaundryStaff').eq('active', true)
    const orderIds = [...new Set((assignments || []).map(row => row.order_id))]
    if (orderIds.length === 0) { setOrders([]); setSelectedOrderId(''); setLoading(false); return }
    const { data } = await supabase.from('orders').select('id, status, estimated_price, created_at')
      .in('id', orderIds).order('updated_at', { ascending: false })
    const nextOrders = (data || []) as StaffOrder[]
    setOrders(nextOrders)
    setSelectedOrderId(current => nextOrders.some(order => order.id === current) ? current : nextOrders[0]?.id || '')
    setLoading(false)
  }, [staffId])
  const loadDetails = useCallback(async (orderId: string) => {
    if (!supabase || !orderId) { setItems([]); setIssues([]); return }
    const [{ data: itemRows }, { data: issueRows }] = await Promise.all([
      supabase.from('order_items').select('id, description, quantity, item_status').eq('order_id', orderId).order('created_at'),
      supabase.from('processing_issues').select('id, order_item_id, note, created_at, resolved').eq('order_id', orderId).order('created_at', { ascending: false }),
    ])
    setItems((itemRows || []) as StaffOrderItem[])
    setIssues((issueRows || []) as ProcessingIssue[])
    setIssueItemId('')
  }, [])
  useEffect(() => { void Promise.resolve().then(loadOrders) }, [loadOrders])
  useEffect(() => { void Promise.resolve().then(() => loadDetails(selectedOrderId)) }, [loadDetails, selectedOrderId])
  const selectedOrder = orders.find(order => order.id === selectedOrderId)
  const nextStatus: Record<string, string> = { 'Picked Up': 'In Processing', 'In Processing': 'Ready', Ready: 'Out for Delivery' }

  async function changeOrderStatus(status: string) {
    if (!supabase || !selectedOrderId) return
    setBusy(true); setError(''); setMessage('')
    const { error: updateError } = await supabase.from('orders').update({ status }).eq('id', selectedOrderId)
    setBusy(false)
    if (updateError) { setError('Could not update this order. Confirm your active assignment and try again.'); return }
    setMessage(`Order status updated to ${status}.`)
    await loadOrders()
  }
  async function changeItemStatus(itemId: string, itemStatus: string) {
    if (!supabase) return
    const { error: updateError } = await supabase.from('order_items').update({ item_status: itemStatus }).eq('id', itemId).eq('order_id', selectedOrderId)
    if (updateError) { setError('Could not update that item. Please try again.'); return }
    setItems(current => current.map(item => item.id === itemId ? { ...item, item_status: itemStatus } : item))
    setError('')
  }
  async function flagIssue(event: FormEvent) {
    event.preventDefault(); if (!supabase || !selectedOrderId || !issueNote.trim()) return
    setBusy(true); setError(''); setMessage('')
    const { error: insertError } = await supabase.from('processing_issues').insert({
      order_id: selectedOrderId, order_item_id: issueItemId || null, reported_by: staffId, note: issueNote.trim(),
    })
    setBusy(false)
    if (insertError) { setError('Could not record the issue. Confirm your active assignment and try again.'); return }
    setIssueNote(''); setIssueItemId(''); setMessage('Processing issue recorded.')
    await loadDetails(selectedOrderId)
  }

  return <section className="staff-card" aria-labelledby="staff-workflow-title">
    <div className="order-heading"><div><p className="eyebrow">Laundry floor</p><h2 id="staff-workflow-title">Assigned orders</h2></div><button className="refresh-button" type="button" onClick={() => void loadOrders()} disabled={loading}>Refresh</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}
    {loading ? <p className="muted">Loading your assignments…</p> : orders.length === 0 ? <p className="muted">No orders are currently assigned to you.</p> : <div className="staff-layout">
      <nav className="assigned-order-list" aria-label="Assigned orders">{orders.map(order => <button type="button" key={order.id} className={order.id === selectedOrderId ? 'selected' : ''} onClick={() => { setSelectedOrderId(order.id); setMessage(''); setError('') }}><strong>Order {order.id.slice(0, 8)}</strong><span>{order.status}</span></button>)}</nav>
      {selectedOrder && <div className="staff-detail"><div className="staff-order-summary"><div><span className="eyebrow">Order status</span><h3>{selectedOrder.status}</h3><p>Estimate ${Number(selectedOrder.estimated_price).toFixed(2)}</p></div>{nextStatus[selectedOrder.status] && <button className="primary next-status" type="button" disabled={busy} onClick={() => void changeOrderStatus(nextStatus[selectedOrder.status])}>{busy ? 'Saving…' : `Move to ${nextStatus[selectedOrder.status]}`}</button>}</div>
        <div className="staff-item-list"><h3>Items</h3>{items.map(item => <div className="staff-item" key={item.id}><div><strong>{item.description}</strong><small>Quantity {item.quantity}</small></div><select aria-label={`Status for ${item.description}`} value={item.item_status || 'Pending'} onChange={event => void changeItemStatus(item.id, event.target.value)}><option>Pending</option><option>In Processing</option><option>Ready</option><option>Issue Flagged</option></select></div>)}</div>
        <form className="issue-form" onSubmit={flagIssue}><h3>Flag a processing issue</h3><label>Related item <span>(optional)</span><select value={issueItemId} onChange={event => setIssueItemId(event.target.value)}><option value="">Order-level issue</option>{items.map(item => <option key={item.id} value={item.id}>{item.description}</option>)}</select></label><label>Issue note<textarea value={issueNote} onChange={event => setIssueNote(event.target.value)} rows={3} placeholder="Describe the issue for the team" required /></label><button className="primary" disabled={busy || !issueNote.trim()}>{busy ? 'Recording…' : 'Record issue'}</button></form>
        <div className="issue-history"><h3>Issue history</h3>{issues.length === 0 ? <p className="muted">No issues recorded for this order.</p> : issues.map(issue => <article key={issue.id}><span>{issue.order_item_id ? items.find(item => item.id === issue.order_item_id)?.description || 'Item issue' : 'Order-level issue'}</span><p>{issue.note}</p><small>{new Date(issue.created_at).toLocaleString()} · {issue.resolved ? 'Resolved' : 'Open'}</small></article>)}</div>
      </div>}
    </div>}
  </section>
}

function AdminDashboard() {
  const [orders, setOrders] = useState<{ status: string }[]>([])
  const [revenue, setRevenue] = useState(0)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadReport = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    const [{ data: orderRows, error: orderError }, { data: invoiceRows, error: invoiceError }] = await Promise.all([
      supabase.from('orders').select('status'),
      supabase.from('invoices').select('amount'),
    ])
    if (orderError || invoiceError) setError('Could not load the report. Confirm this account has Administrator access.')
    setOrders((orderRows || []) as { status: string }[])
    const invoices = (invoiceRows || []) as InvoiceRow[]
    setInvoiceCount(invoices.length)
    setRevenue(invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0))
    setLoading(false)
  }, [])
  useEffect(() => { void Promise.resolve().then(loadReport) }, [loadReport])
  const statuses = ['Created', 'Pickup Scheduled', 'Picked Up', 'In Processing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled']
  return <section className="admin-card" aria-labelledby="admin-report-title">
    <div className="order-heading"><div><p className="eyebrow">Operations snapshot</p><h2 id="admin-report-title">Orders and revenue</h2></div><button className="refresh-button" type="button" onClick={() => void loadReport()} disabled={loading}>Refresh report</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading report…</p> : <><div className="report-summary"><article><span>Total orders</span><strong>{orders.length}</strong></article><article><span>Invoiced revenue</span><strong>${revenue.toFixed(2)}</strong></article><article><span>Invoices</span><strong>{invoiceCount}</strong></article></div><div className="status-report"><h3>Orders by status</h3><div className="status-grid">{statuses.map(status => <article key={status}><span>{status}</span><strong>{orders.filter(order => order.status === status).length}</strong></article>)}</div></div></>}
  </section>
}

function CustomerOrderTracker({ customerId }: { customerId: string }) {
  const [orders, setOrders] = useState<CustomerTrackedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const loadOrders = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('orders').select('id, status, estimated_price, created_at, updated_at')
      .eq('customer_id', customerId).order('created_at', { ascending: false })
    setOrders((data || []) as CustomerTrackedOrder[])
    setLoading(false)
  }, [customerId])
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    void Promise.resolve().then(loadOrders)
    const channel = client.channel(`customer-orders-${customerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${customerId}` }, () => { void loadOrders() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [customerId, loadOrders])
  return <section className="tracking-card" aria-labelledby="tracking-title"><div className="order-heading"><div><p className="eyebrow">Live updates</p><h2 id="tracking-title">Track your orders</h2></div><span className="live-indicator"><i /> Live</span></div>{loading ? <p className="muted">Loading your orders…</p> : orders.length === 0 ? <p className="muted">Your orders will appear here as you place them.</p> : <div className="tracked-orders">{orders.map(order => <article className="tracked-order" key={order.id}><div><strong>Order {order.id.slice(0, 8)}</strong><span>Updated {new Date(order.updated_at).toLocaleString()}</span></div><div className="tracked-status"><b>{order.status}</b><span>${Number(order.estimated_price).toFixed(2)}</span></div></article>)}</div>}</section>
}

/**
 * CustomerNotifications Component (FR-029 & FR-030)
 * Viva Demo Note:
 * Displays incoming emails/notifications dispatched across order lifecycles:
 * - Order Created (UC-003)
 * - Pickup/Delivery Scheduled (UC-005)
 * - In Processing (Staff Workflow)
 * - Order Ready / "Pick up your laundry" (Staff Workflow completion)
 * - Delivered / Exceptions (UC-010)
 * Uses Supabase Realtime to update live when new alerts arrive.
 */
function CustomerNotifications({ customerId }: { customerId: string }) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)

  const loadNotifications = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('notifications')
      .select('id, order_id, notification_type, message, delivery_status, created_at, read_at')
      .eq('recipient_id', customerId)
      .order('created_at', { ascending: false })
    setNotifications((data || []) as NotificationRow[])
    setLoading(false)
  }, [customerId])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    void Promise.resolve().then(loadNotifications)

    // Realtime subscription for incoming push/email notifications
    const channel = client.channel(`customer-notifications-${customerId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${customerId}`,
      }, () => { void loadNotifications() })
      .subscribe()

    return () => { void client.removeChannel(channel) }
  }, [customerId, loadNotifications])

  async function markAsRead(id: string) {
    if (!supabase) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    setNotifications(current => current.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  function getTypeBadge(type: string) {
    switch (type) {
      case 'ORDER_READY':
        return <span className="notification-pill-type type-ready">Laundry Ready / Pick Up</span>
      case 'ORDER_PROCESSING':
        return <span className="notification-pill-type type-processing">In Progress</span>
      case 'ORDER_CREATED':
        return <span className="notification-pill-type type-created">Order Created</span>
      case 'DELIVERY_CONFIRMED':
        return <span className="notification-pill-type type-delivery">Delivered</span>
      case 'DELIVERY_EXCEPTION':
        return <span className="notification-pill-type type-exception">Action Needed</span>
      default:
        return <span className="notification-pill-type type-processing">{type}</span>
    }
  }

  return (
    <section className="notification-card" aria-labelledby="notification-center-title">
      <div className="order-heading">
        <div>
          <p className="eyebrow">Customer Inbox &amp; Email Alerts</p>
          <h2 id="notification-center-title">
            Notifications
            <span className={`notification-badge ${unreadCount > 0 ? 'unread' : 'read'}`}>
              {unreadCount} new
            </span>
          </h2>
        </div>
        <button className="refresh-button" type="button" onClick={() => void loadNotifications()} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading notifications…</p>
      ) : notifications.length === 0 ? (
        <p className="muted" style={{ marginTop: '14px' }}>
          No notifications yet. You will receive updates here and via email when your order status progresses.
        </p>
      ) : (
        <div className="notifications-list">
          {notifications.map(n => (
            <article key={n.id} className={`notification-item ${n.read_at ? 'read' : 'unread'}`}>
              <div className="notification-item-content">
                {getTypeBadge(n.notification_type)}
                <strong>{n.message}</strong>
                <small>
                  {n.order_id && `Order #${n.order_id.slice(0, 8)} · `}
                  {new Date(n.created_at).toLocaleString()}
                </small>
              </div>
              <div className="notification-actions">
                {!n.read_at && (
                  <button className="mark-read-btn" onClick={() => void markAsRead(n.id)}>
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
function SetupNotice({ message }: { message: string }) { return <main className="page centered"><section className="notice"><span className="eyebrow">LaundryHub setup</span><h1>One more step</h1><p>{message}</p></section></main> }
export default App
