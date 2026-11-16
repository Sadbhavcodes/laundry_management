-- Local development credentials (all users): Password123!
-- Idempotent enough for `supabase db reset`; do not use these identities in production.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_user_meta_data, created_at, updated_at
)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer@laundryhub.test', crypt('Password123!', gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"name":"Casey Customer"}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@laundryhub.test', crypt('Password123!', gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"name":"Sam Staff"}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delivery@laundryhub.test', crypt('Password123!', gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"name":"Devi Delivery"}', now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@laundryhub.test', crypt('Password123!', gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"name":"Avery Admin"}', now(), now())
on conflict (id) do nothing;

-- Repair older local seed rows written before current GoTrue required non-null token strings.
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000004'
);

update public.profiles set role = 'LaundryStaff', name = 'Sam Staff' where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set role = 'DeliveryPersonnel', name = 'Devi Delivery' where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'Administrator', name = 'Avery Admin' where id = '10000000-0000-0000-0000-000000000004';
insert into public.laundry_staff (user_id, employee_code) values ('10000000-0000-0000-0000-000000000002', 'LH-LS-001') on conflict do nothing;
insert into public.delivery_personnel (user_id, employee_code) values ('10000000-0000-0000-0000-000000000003', 'LH-DP-001') on conflict do nothing;

insert into public.pickup_delivery_slots (slot_start, slot_end, capacity, slot_type) values
  ('2026-10-22 09:00:00+05:30', '2026-10-22 11:00:00+05:30', 2, 'Pickup'),
  ('2026-10-22 12:00:00+05:30', '2026-10-22 14:00:00+05:30', 4, 'Delivery'),
  ('2026-10-23 09:00:00+05:30', '2026-10-23 11:00:00+05:30', 6, 'Pickup'),
  ('2026-10-23 14:00:00+05:30', '2026-10-23 16:00:00+05:30', 8, 'Delivery'),
  ('2026-10-24 10:00:00+05:30', '2026-10-24 12:00:00+05:30', 10, 'Pickup');
