-- UC-010 / BR-006 / BR-007: account for every item before delivery completion.
create or replace function public.generate_invoice(p_order_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_amount numeric(12,2);
begin
  if not exists (select 1 from public.orders where id = p_order_id and status = 'Delivered') then
    raise exception 'Invoice may be generated only after delivery';
  end if;
  select * into v_invoice from public.invoices where order_id = p_order_id;
  if found then return v_invoice; end if;

  select coalesce(sum(quantity * unit_price), 0)::numeric(12,2)
    into v_amount
    from public.order_items
    where order_id = p_order_id;

  insert into public.invoices (order_id, amount)
  values (p_order_id, v_amount)
  on conflict (order_id) do nothing;

  select * into v_invoice from public.invoices where order_id = p_order_id;
  return v_invoice;
end;
$$;

revoke all on function public.generate_invoice(uuid) from public, anon, authenticated;

create or replace function public.record_delivery(
  p_order_id uuid,
  p_item_confirmations jsonb,
  p_personnel_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := auth.jwt() ->> 'session_id';
  v_order public.orders;
  v_item public.order_items;
  v_confirmation jsonb;
  v_outcome text;
  v_exception_type text;
  v_exception_id uuid;
  v_exception_ids uuid[] := array[]::uuid[];
  v_invoice public.invoices;
  v_item_count integer;
  v_confirmed_count integer;
  v_ordered_item_ids uuid[];
  v_submitted_item_ids uuid[];
begin
  if v_user_id is null or v_session_id is null or not exists (
    select 1 from public.session_log
    where user_id = v_user_id and session_id = v_session_id and active
  ) then
    return jsonb_build_object('error', 'UNAUTHENTICATED');
  end if;
  if p_personnel_id is distinct from v_user_id or not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'DeliveryPersonnel' and account_status = 'Active'
  ) then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;
  if jsonb_typeof(p_item_confirmations) is distinct from 'array' then
    return jsonb_build_object('error', 'ITEMS_UNACCOUNTED');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not exists (
    select 1 from public.staff_assignments
    where order_id = p_order_id and staff_id = v_user_id
      and assignment_role = 'DeliveryPersonnel' and active
  ) then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;
  if v_order.status = 'Delivered' then
    select * into v_invoice from public.invoices where order_id = p_order_id;
    if not found then v_invoice := public.generate_invoice(p_order_id); end if;
    return jsonb_build_object(
      'orderId', p_order_id, 'status', 'Delivered',
      'invoice', jsonb_build_object('id', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
                                    'amount', v_invoice.amount, 'issuedAt', v_invoice.issued_at),
      'alreadyDelivered', true
    );
  end if;
  if v_order.status <> 'Out for Delivery' then
    return jsonb_build_object('error', 'ORDER_NOT_DELIVERABLE');
  end if;

  select count(*), array_agg(id order by id)
    into v_item_count, v_ordered_item_ids
    from public.order_items where order_id = p_order_id;
  select count(*), array_agg((value ->> 'itemId')::uuid order by (value ->> 'itemId')::uuid)
    into v_confirmed_count, v_submitted_item_ids
    from jsonb_array_elements(p_item_confirmations);
  if v_item_count = 0 or v_confirmed_count <> v_item_count
     or v_submitted_item_ids is distinct from v_ordered_item_ids then
    return jsonb_build_object('error', 'ITEMS_UNACCOUNTED');
  end if;

  -- Validate the entire checklist before changing any item or inserting exceptions.
  for v_confirmation in select value from jsonb_array_elements(p_item_confirmations)
  loop
    if coalesce(v_confirmation ->> 'outcome', '') not in
       ('received', 'missing', 'damaged', 'failed_delivery_attempt') then
      return jsonb_build_object('error', 'INVALID_CONFIRMATION');
    end if;
  end loop;

  for v_confirmation in select value from jsonb_array_elements(p_item_confirmations)
  loop
    select * into v_item from public.order_items
    where id = (v_confirmation ->> 'itemId')::uuid and order_id = p_order_id
    for update;
    v_outcome := v_confirmation ->> 'outcome';
    if v_outcome = 'received' then
      update public.order_items set handover_confirmed = true, item_status = 'Handed Over'
      where id = v_item.id;
    else
      v_exception_type := case v_outcome
        when 'missing' then 'Missing Item'
        when 'damaged' then 'Damaged Item'
        else 'Failed Delivery Attempt'
      end;
      insert into public.delivery_exceptions (order_id, order_item_id, reported_by, exception_type, notes)
      values (p_order_id, v_item.id, v_user_id, v_exception_type, nullif(trim(v_confirmation ->> 'notes'), ''))
      returning id into v_exception_id;
      v_exception_ids := array_append(v_exception_ids, v_exception_id);
    end if;
  end loop;

  if cardinality(v_exception_ids) > 0 or exists (
    select 1 from public.delivery_exceptions
    where order_id = p_order_id and not resolved
  ) then
    update public.orders set review_flag = true where id = p_order_id;
    insert into public.notifications (recipient_id, order_id, notification_type, message)
    values (v_order.customer_id, p_order_id, 'DELIVERY_EXCEPTION', 'A delivery exception was recorded and requires review.');
    return jsonb_build_object(
      'orderId', p_order_id, 'status', 'Exception Recorded / Review Required',
      'exceptions', coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'itemId', order_item_id,
                                            'type', exception_type, 'notes', notes))
        from public.delivery_exceptions where order_id = p_order_id and not resolved
      ), '[]'::jsonb)
    );
  end if;

  update public.orders set status = 'Delivered' where id = p_order_id;
  v_invoice := public.generate_invoice(p_order_id);
  insert into public.notifications (recipient_id, order_id, notification_type, message)
  values (v_order.customer_id, p_order_id, 'DELIVERY_CONFIRMED', 'Your laundry order has been delivered.');

  return jsonb_build_object(
    'orderId', p_order_id, 'status', 'Delivered',
    'invoice', jsonb_build_object('id', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
                                  'amount', v_invoice.amount, 'issuedAt', v_invoice.issued_at)
  );
end;
$$;

revoke all on function public.record_delivery(uuid, jsonb, uuid) from public, anon;
grant execute on function public.record_delivery(uuid, jsonb, uuid) to authenticated;
