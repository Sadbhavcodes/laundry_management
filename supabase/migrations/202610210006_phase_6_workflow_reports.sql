-- ============================================================================
-- 202610210006_phase_6_workflow_reports.sql
-- LaundryStaff Processing Issues, RLS Updates & Supabase Realtime Publication
-- Traceability: FR-017–FR-021 (Staff Workflow), FR-030 (Realtime Tracking), FR-033–FR-036 (Reports)
-- 
-- VIVA EXAM EXPLANATION:
-- 1. processing_issues: Table tracking notes on specific items or entire orders logged by staff.
-- 2. RLS Policies: Allows LaundryStaff to update assigned orders and items only when an active
--    staff_assignment row exists.
-- 3. alter publication supabase_realtime add table public.orders:
--    Enables WebSocket CDC (Change Data Capture) streaming so customers get instant live updates
--    whenever an order moves through the processing lifecycle.
-- ============================================================================

-- LaundryStaff workflow issue notes, assignment-scoped updates, and customer order Realtime.
create table public.processing_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  reported_by uuid not null references public.laundry_staff(user_id),
  note text not null check (length(trim(note)) > 0),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index processing_issues_order_created_idx on public.processing_issues(order_id, created_at desc);
alter table public.processing_issues enable row level security;

create policy "laundry staff view issues for assigned orders" on public.processing_issues
  for select using (
    public.is_administrator() or (
      reported_by = auth.uid() and exists (
        select 1 from public.staff_assignments a
        where a.order_id = processing_issues.order_id and a.staff_id = auth.uid()
          and a.assignment_role = 'LaundryStaff' and a.active
      )
    )
  );
create policy "laundry staff create issues for assigned orders" on public.processing_issues
  for insert with check (
    reported_by = auth.uid() and exists (
      select 1 from public.staff_assignments a
      where a.order_id = processing_issues.order_id and a.staff_id = auth.uid()
        and a.assignment_role = 'LaundryStaff' and a.active
    ) and (
      order_item_id is null or exists (
        select 1 from public.order_items i
        where i.id = processing_issues.order_item_id and i.order_id = processing_issues.order_id
      )
    )
  );
create policy "administrators manage processing issues" on public.processing_issues
  for all using (public.is_administrator()) with check (public.is_administrator());

create policy "laundry staff update assigned orders" on public.orders
  for update using (public.has_active_assignment(id, 'LaundryStaff'))
  with check (public.has_active_assignment(id, 'LaundryStaff'));
create policy "laundry staff update items on assigned orders" on public.order_items
  for update using (public.has_active_assignment(order_id, 'LaundryStaff'))
  with check (public.has_active_assignment(order_id, 'LaundryStaff'));

-- Supabase Realtime only streams tables included in its publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
