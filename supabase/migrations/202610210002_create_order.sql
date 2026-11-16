-- UC-003: a submitted order, its items, and its ORDER_CREATED notification commit together.
-- Prices are chosen server-side by service type so the browser cannot alter the estimate.
create or replace function public.create_order_atomic(
  p_items jsonb,
  p_handling_instructions text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_estimated_price numeric(12,2);
  v_item jsonb;
  v_service_type text;
  v_unit_price numeric(12,2);
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'UNAUTHENTICATED');
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'Customer' and account_status = 'Active'
  ) then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('error', 'EMPTY_ORDER');
  end if;
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'EMPTY_ORDER');
  end if;

  -- Repeat input checks in the transaction boundary in case another caller bypasses the Edge Function.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or nullif(trim(v_item ->> 'description'), '') is null
       or nullif(trim(v_item ->> 'serviceType'), '') is null then
      return jsonb_build_object('error', 'INVALID_ITEM');
    end if;
    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]+$'
       or (v_item ->> 'quantity')::numeric not between 1 and 2147483647 then
      return jsonb_build_object('error', 'INVALID_QUANTITY');
    end if;
    if v_item ->> 'serviceType' not in ('Wash & Fold', 'Dry Cleaning', 'Pressing', 'Delicates') then
      return jsonb_build_object('error', 'INVALID_ITEM');
    end if;
  end loop;

  select sum((item ->> 'quantity')::integer * price.unit_price)
    into v_estimated_price
    from jsonb_array_elements(p_items) as entries(item)
    cross join lateral (
      select case item ->> 'serviceType'
        when 'Wash & Fold' then 5.00::numeric
        when 'Dry Cleaning' then 12.00::numeric
        when 'Pressing' then 4.00::numeric
        when 'Delicates' then 7.50::numeric
      end as unit_price
    ) price;

  insert into public.orders (customer_id, status, handling_instructions, estimated_price)
  values (v_user_id, 'Created', nullif(trim(p_handling_instructions), ''), v_estimated_price)
  returning id into v_order_id;

  insert into public.order_items (order_id, description, service_type, quantity, unit_price)
  select v_order_id, item ->> 'description', item ->> 'serviceType',
         (item ->> 'quantity')::integer,
         case item ->> 'serviceType'
           when 'Wash & Fold' then 5.00
           when 'Dry Cleaning' then 12.00
           when 'Pressing' then 4.00
           when 'Delicates' then 7.50
         end
  from jsonb_array_elements(p_items) as entries(item);

  insert into public.notifications (recipient_id, order_id, notification_type, message)
  values (v_user_id, v_order_id, 'ORDER_CREATED', 'Your laundry order has been created.');

  return jsonb_build_object(
    'orderId', v_order_id,
    'status', 'Created',
    'estimatedPrice', v_estimated_price
  );
end;
$$;

revoke all on function public.create_order_atomic(jsonb, text) from public, anon;
grant execute on function public.create_order_atomic(jsonb, text) to authenticated;
