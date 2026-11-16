begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(23);

-- Isolated fixture set: the surrounding transaction is rolled back after pgTAP reports results.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase7-customer@test.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase7-driver@test.invalid', '', now(), now(), now());
insert into public.profiles (id, role, name, contact_info, account_status)
values
  ('00000000-0000-4000-8000-000000000001', 'Customer', 'Phase 7 Customer', '{}', 'Active'),
  ('00000000-0000-4000-8000-000000000002', 'DeliveryPersonnel', 'Phase 7 Driver', '{}', 'Active');
insert into public.customers (user_id) values ('00000000-0000-4000-8000-000000000001');
insert into public.delivery_personnel (user_id) values ('00000000-0000-4000-8000-000000000002');
insert into public.session_log (user_id, session_id, active)
values ('00000000-0000-4000-8000-000000000002', 'phase7-active-session', true);

insert into public.pickup_delivery_slots (id, slot_start, slot_end, capacity, booked_count, slot_type)
values
  ('00000000-0000-4000-8000-000000000021', now() + interval '1 day', now() + interval '1 day 1 hour', 1, 0, 'Pickup'),
  ('00000000-0000-4000-8000-000000000022', now() + interval '2 days', now() + interval '2 days 1 hour', 1, 0, 'Pickup'),
  ('00000000-0000-4000-8000-000000000023', now() + interval '3 days', now() + interval '3 days 1 hour', 1, 0, 'Delivery'),
  ('00000000-0000-4000-8000-000000000024', now() + interval '4 days', now() + interval '4 days 1 hour', 1, 0, 'Delivery');

insert into public.orders (id, customer_id, status)
values
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'Created'),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Created'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Out for Delivery'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Out for Delivery');
insert into public.order_items (id, order_id, description, service_type, quantity, unit_price)
values
  ('00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000012', 'Missing shirt', 'Wash & Fold', 1, 5),
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000012', 'Damaged jacket', 'Dry Cleaning', 1, 12),
  ('00000000-0000-4000-8000-000000000130', '00000000-0000-4000-8000-000000000013', 'Clean shirts', 'Wash & Fold', 2, 5),
  ('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000013', 'Clean jacket', 'Dry Cleaning', 1, 12);
insert into public.staff_assignments (order_id, staff_id, assignment_role, active)
values
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'DeliveryPersonnel', true),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000002', 'DeliveryPersonnel', true);

create temporary table phase7_results (name text primary key, value jsonb);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into phase7_results values ('create_ok', public.create_order_atomic(
  '[{"description":"Shirt","serviceType":"Wash & Fold","quantity":2},{"description":"Jacket","serviceType":"Dry Cleaning","quantity":1}]', null
));
select is((select value->>'status' from phase7_results where name='create_ok'), 'Created', 'create order creates a Created order');
select is((select (value->>'estimatedPrice')::numeric from phase7_results where name='create_ok'), 22::numeric, 'create order estimates quantity times server price');
select is((select count(*)::int from public.order_items where order_id=(select (value->>'orderId')::uuid from phase7_results where name='create_ok')), 2, 'create order persists all associated items');
insert into phase7_results values ('empty', public.create_order_atomic('[]', null));
select is((select value->>'error' from phase7_results where name='empty'), 'EMPTY_ORDER', 'empty order is rejected');
select is((select count(*)::int from public.orders where customer_id='00000000-0000-4000-8000-000000000001'), 5, 'empty validation failure leaves no partial order');
insert into phase7_results values ('bad_quantity', public.create_order_atomic('[{"description":"Shirt","serviceType":"Wash & Fold","quantity":0}]', null));
select is((select value->>'error' from phase7_results where name='bad_quantity'), 'INVALID_QUANTITY', 'invalid quantity is rejected');
select is((select count(*)::int from public.orders where customer_id='00000000-0000-4000-8000-000000000001'), 5, 'quantity validation failure leaves no partial order');

insert into phase7_results values ('schedule_ok', public.schedule_order(
  '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000023'
));
select is((select value->>'status' from phase7_results where name='schedule_ok'), 'Pickup Scheduled', 'schedule reserves both slots for a valid order');
select is((select booked_count from public.pickup_delivery_slots where id='00000000-0000-4000-8000-000000000021'), 1, 'successful schedule books pickup slot');
select is((select booked_count from public.pickup_delivery_slots where id='00000000-0000-4000-8000-000000000023'), 1, 'successful schedule books delivery slot');
insert into phase7_results values ('pickup_full', public.schedule_order(
  '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000024'
));
select is((select value->>'error' from phase7_results where name='pickup_full'), 'SLOT_UNAVAILABLE', 'full pickup slot rejects reservation');
select is((select booked_count from public.pickup_delivery_slots where id='00000000-0000-4000-8000-000000000024'), 0, 'pickup conflict does not book the available delivery slot');
insert into phase7_results values ('delivery_full', public.schedule_order(
  '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000023'
));
select is((select value->>'error' from phase7_results where name='delivery_full'), 'SLOT_UNAVAILABLE', 'full delivery slot rejects reservation');
select is((select booked_count from public.pickup_delivery_slots where id='00000000-0000-4000-8000-000000000022'), 0, 'delivery conflict does not book the available pickup slot');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","session_id":"phase7-active-session","role":"authenticated"}', true);
insert into phase7_results values ('delivery_exception', public.record_delivery(
  '00000000-0000-4000-8000-000000000012',
  '[{"itemId":"00000000-0000-4000-8000-000000000120","outcome":"missing"},{"itemId":"00000000-0000-4000-8000-000000000121","outcome":"damaged"}]',
  '00000000-0000-4000-8000-000000000002'
));
select is((select value->>'status' from phase7_results where name='delivery_exception'), 'Exception Recorded / Review Required', 'missing and damaged outcomes take exception path');
select ok((select review_flag from public.orders where id='00000000-0000-4000-8000-000000000012'), 'exception path sets review_flag');
select is((select status::text from public.orders where id='00000000-0000-4000-8000-000000000012'), 'Out for Delivery', 'exception path does not mark order Delivered');
select is((select count(*)::int from public.delivery_exceptions where order_id='00000000-0000-4000-8000-000000000012'), 2, 'missing and damaged outcomes each create an exception');
select is((select count(*)::int from public.invoices where order_id='00000000-0000-4000-8000-000000000012'), 0, 'exception path does not issue invoice');

insert into phase7_results values ('delivery_ok', public.record_delivery(
  '00000000-0000-4000-8000-000000000013',
  '[{"itemId":"00000000-0000-4000-8000-000000000130","outcome":"received"},{"itemId":"00000000-0000-4000-8000-000000000131","outcome":"received"}]',
  '00000000-0000-4000-8000-000000000002'
));
select is((select value->>'status' from phase7_results where name='delivery_ok'), 'Delivered', 'all received items complete delivery');
select is((select (value->'invoice'->>'amount')::numeric from phase7_results where name='delivery_ok'), 22::numeric, 'delivery creates invoice from item quantities and prices');
insert into phase7_results values ('delivery_retry', public.record_delivery(
  '00000000-0000-4000-8000-000000000013',
  '[{"itemId":"00000000-0000-4000-8000-000000000130","outcome":"received"},{"itemId":"00000000-0000-4000-8000-000000000131","outcome":"received"}]',
  '00000000-0000-4000-8000-000000000002'
));
select ok((select (value->>'alreadyDelivered')::boolean from phase7_results where name='delivery_retry'), 'already-delivered retry returns the existing invoice path');
select is((select count(*)::int from public.invoices where order_id='00000000-0000-4000-8000-000000000013'), 1, 'delivery retry never creates a duplicate invoice');

select * from finish();
rollback;
