-- ============================================================================
-- 202610210003_schedule_order.sql
-- Function: public.schedule_order(p_order_id, p_pickup_slot_id, p_delivery_slot_id)
-- Traceability: UC-005, FR-013, FR-014, FR-030; BR-003 (Both slots or neither)
-- 
-- VIVA EXAM EXPLANATION:
-- Implements dual-slot scheduling with pessimistic concurrency control:
-- 1. Checks Preconditions: Order must exist in 'Created' status and belong to the user.
-- 2. Row-Level Locks: Locks both slot rows using 'SELECT ... FOR UPDATE' in deterministic
--    UUID order to avoid deadlocks between concurrent customers.
-- 3. Capacity Invariant (BR-003): Checks booked_count < capacity for both slots.
-- 4. Atomic Increment: Increments booked_count on both slots and moves Order status to 'Pickup Scheduled'.
-- 5. All-or-Nothing: If either slot has reached capacity, rolls back completely.
-- ============================================================================
create or replace function public.schedule_order(
  p_order_id uuid,
  p_pickup_slot_id uuid,
  p_delivery_slot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slot record;
  v_pickup record;
  v_delivery record;
  v_pickup_found boolean := false;
  v_delivery_found boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;
  if p_pickup_slot_id = p_delivery_slot_id then
    return jsonb_build_object('error', 'SLOT_UNAVAILABLE');
  end if;
  if not exists (
    select 1 from public.orders
    where id = p_order_id and customer_id = v_user_id and status = 'Created'
  ) then
    return jsonb_build_object('error', 'ORDER_NOT_SCHEDULABLE');
  end if;

  -- Lock in UUID order to prevent competing requests from deadlocking each other.
  for v_slot in
    select id, slot_type, active, capacity, booked_count
    from public.pickup_delivery_slots
    where id in (p_pickup_slot_id, p_delivery_slot_id)
    order by id
    for update
  loop
    if v_slot.id = p_pickup_slot_id then v_pickup := v_slot; v_pickup_found := true; end if;
    if v_slot.id = p_delivery_slot_id then v_delivery := v_slot; v_delivery_found := true; end if;
  end loop;

  if not v_pickup_found or not v_delivery_found then
    return jsonb_build_object('error', 'SLOT_UNAVAILABLE');
  end if;
  if v_pickup.slot_type <> 'Pickup' or v_delivery.slot_type <> 'Delivery'
     or not v_pickup.active or not v_delivery.active
     or v_pickup.booked_count >= v_pickup.capacity
     or v_delivery.booked_count >= v_delivery.capacity then
    return jsonb_build_object('error', 'SLOT_UNAVAILABLE');
  end if;

  update public.pickup_delivery_slots
  set booked_count = booked_count + 1
  where id in (p_pickup_slot_id, p_delivery_slot_id);

  update public.orders
  set pickup_slot_id = p_pickup_slot_id,
      delivery_slot_id = p_delivery_slot_id,
      status = 'Pickup Scheduled'
  where id = p_order_id and customer_id = v_user_id and status = 'Created';

  -- A concurrent status transition after the precheck means the whole function must fail.
  if not found then
    raise exception using errcode = '40001', message = 'Concurrent order update';
  end if;

  insert into public.notifications (recipient_id, order_id, notification_type, message)
  values (v_user_id, p_order_id, 'SCHEDULE_CONFIRMED', 'Your pickup and delivery slots are confirmed.');

  return jsonb_build_object(
    'orderId', p_order_id,
    'pickupSlotId', p_pickup_slot_id,
    'deliverySlotId', p_delivery_slot_id,
    'status', 'Pickup Scheduled'
  );
end;
$$;

revoke all on function public.schedule_order(uuid, uuid, uuid) from public, anon;
grant execute on function public.schedule_order(uuid, uuid, uuid) to authenticated;
