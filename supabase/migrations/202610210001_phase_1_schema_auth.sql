-- LaundryHub Phase 1: SRS 46.2 / 46.3 domain model and authentication foundation.
-- `profiles` is the persisted User base class; auth.users remains the identity source.

create extension if not exists pgcrypto;

create type public.user_role as enum ('Customer', 'LaundryStaff', 'DeliveryPersonnel', 'Administrator');
create type public.account_status as enum ('Active', 'Inactive', 'Suspended');
create type public.order_status as enum (
  'Created', 'Pickup Scheduled', 'Picked Up', 'In Processing',
  'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'Customer',
  name text not null check (length(trim(name)) > 0),
  contact_info jsonb not null default '{}'::jsonb,
  account_status public.account_status not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  default_address text,
  created_at timestamptz not null default now()
);
create table public.laundry_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  employee_code text unique,
  created_at timestamptz not null default now()
);
create table public.delivery_personnel (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  employee_code text unique,
  vehicle_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- AuthenticationSession analogue. Supabase Auth owns credentials and refresh tokens.
create table public.session_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id text not null unique,
  login_time timestamptz not null default now(),
  logout_time timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pickup_delivery_slots (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  capacity integer not null check (capacity between 1 and 1000),
  booked_count integer not null default 0 check (booked_count between 0 and capacity),
  slot_type text not null check (slot_type in ('Pickup', 'Delivery')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (slot_end > slot_start)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(user_id),
  status public.order_status not null default 'Created',
  pickup_slot_id uuid references public.pickup_delivery_slots(id),
  delivery_slot_id uuid references public.pickup_delivery_slots(id),
  pickup_address text,
  delivery_address text,
  handling_instructions text,
  estimated_price numeric(12,2) not null default 0 check (estimated_price >= 0),
  review_flag boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- OrderItem is composition: an item cannot outlive its Order. A draft may contain zero items.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  service_type text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  item_status text,
  handover_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  assignment_role public.user_role not null check (assignment_role in ('LaundryStaff', 'DeliveryPersonnel')),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (order_id, staff_id, assignment_role)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  invoice_number text not null unique default ('INV-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  amount numeric(12,2) not null check (amount >= 0),
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  payment_status text not null default 'Pending' check (payment_status in ('Pending', 'Paid', 'Void'))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  notification_type text not null,
  message text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  reported_by uuid not null references public.delivery_personnel(user_id),
  exception_type text not null check (exception_type in ('Missing Item', 'Damaged Item', 'Failed Delivery Attempt')),
  notes text,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index orders_customer_id_idx on public.orders(customer_id);
create index order_items_order_id_idx on public.order_items(order_id);
create index staff_assignments_staff_order_idx on public.staff_assignments(staff_id, order_id) where active;
create index session_log_user_id_idx on public.session_log(user_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger order_items_updated_at before update on public.order_items for each row execute function public.set_updated_at();

create or replace function public.prevent_self_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.account_status is distinct from old.account_status)
     and not public.is_administrator() then
    raise exception 'Only an administrator may change an account role or status';
  end if;
  return new;
end; $$;
create trigger profiles_prevent_self_role_change before update on public.profiles for each row execute function public.prevent_self_role_change();

-- New self-service identities always begin as Customers. Staff roles are provisioned by an administrator.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, name, contact_info)
  values (new.id, 'Customer', coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
          jsonb_build_object('email', new.email));
  insert into public.customers (user_id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- SECURITY DEFINER avoids recursive RLS evaluation when policies inspect the caller's profile.
create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as
  $$ select role from public.profiles where id = auth.uid() $$;
create or replace function public.is_administrator() returns boolean
language sql stable security definer set search_path = public as
  $$ select coalesce(public.current_user_role() = 'Administrator', false) $$;
create or replace function public.has_active_assignment(target_order_id uuid, required_role public.user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_assignments
                 where order_id = target_order_id and staff_id = auth.uid()
                   and assignment_role = required_role and active)
$$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.laundry_staff enable row level security;
alter table public.delivery_personnel enable row level security;
alter table public.session_log enable row level security;
alter table public.pickup_delivery_slots enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.invoices enable row level security;
alter table public.notifications enable row level security;
alter table public.delivery_exceptions enable row level security;

create policy "users view own profile" on public.profiles for select using (id = auth.uid() or public.is_administrator());
create policy "users update own profile" on public.profiles for update using (id = auth.uid() or public.is_administrator()) with check (id = auth.uid() or public.is_administrator());
create policy "administrators manage profiles" on public.profiles for all using (public.is_administrator()) with check (public.is_administrator());

create policy "customers manage their customer record" on public.customers for all using (user_id = auth.uid() or public.is_administrator()) with check (user_id = auth.uid() or public.is_administrator());
create policy "administrators manage laundry staff" on public.laundry_staff for all using (public.is_administrator()) with check (public.is_administrator());
create policy "administrators manage delivery personnel" on public.delivery_personnel for all using (public.is_administrator()) with check (public.is_administrator());
create policy "users view own sessions" on public.session_log for select using (user_id = auth.uid() or public.is_administrator());
create policy "users insert own sessions" on public.session_log for insert with check (user_id = auth.uid() or public.is_administrator());
create policy "users update own sessions" on public.session_log for update using (user_id = auth.uid() or public.is_administrator()) with check (user_id = auth.uid() or public.is_administrator());

create policy "authenticated users view slots" on public.pickup_delivery_slots for select to authenticated using (active or public.is_administrator());
create policy "administrators manage slots" on public.pickup_delivery_slots for all using (public.is_administrator()) with check (public.is_administrator());

create policy "customers manage own orders" on public.orders for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "laundry staff view assigned orders" on public.orders for select using (public.has_active_assignment(id, 'LaundryStaff'));
create policy "delivery personnel view assigned orders" on public.orders for select using (public.has_active_assignment(id, 'DeliveryPersonnel'));
create policy "administrators manage orders" on public.orders for all using (public.is_administrator()) with check (public.is_administrator());

create policy "customers manage items on own orders" on public.order_items for all
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()))
  with check (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy "delivery personnel view items on assigned orders" on public.order_items for select using (public.has_active_assignment(order_id, 'DeliveryPersonnel'));
create policy "administrators manage order items" on public.order_items for all using (public.is_administrator()) with check (public.is_administrator());

create policy "staff view own assignments" on public.staff_assignments for select using (staff_id = auth.uid() or public.is_administrator());
create policy "administrators manage assignments" on public.staff_assignments for all using (public.is_administrator()) with check (public.is_administrator());
create policy "customers view invoices for own orders" on public.invoices for select using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()) or public.is_administrator());
create policy "administrators manage invoices" on public.invoices for all using (public.is_administrator()) with check (public.is_administrator());
create policy "users view own notifications" on public.notifications for select using (recipient_id = auth.uid() or public.is_administrator());
create policy "users update own notifications" on public.notifications for update using (recipient_id = auth.uid() or public.is_administrator()) with check (recipient_id = auth.uid() or public.is_administrator());
create policy "administrators manage notifications" on public.notifications for all using (public.is_administrator()) with check (public.is_administrator());
create policy "delivery personnel view own exceptions" on public.delivery_exceptions for select using (reported_by = auth.uid() or public.is_administrator());
create policy "delivery personnel create own exceptions" on public.delivery_exceptions for insert with check (reported_by = auth.uid() and public.has_active_assignment(order_id, 'DeliveryPersonnel'));
create policy "administrators manage delivery exceptions" on public.delivery_exceptions for all using (public.is_administrator()) with check (public.is_administrator());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
