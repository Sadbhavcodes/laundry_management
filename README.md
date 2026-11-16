# LaundryHub

LaundryHub is a laundry-service workflow application built with React, TypeScript, Vite, Supabase Auth/Postgres/Realtime, and Supabase Edge Functions. This README maps every FR/BR/UC reference present in the implementation plan (`plan_text.txt`) to implementation files and documents how to deploy against a fresh Supabase project.

## Project layout

- `frontend/` — customer, LaundryStaff, DeliveryPersonnel, and Administrator UI.
- `supabase/migrations/` — ordered schema, RLS, RPC, and publication changes.
- `supabase/functions/` — Edge Functions and shared validation/notification/CORS code.
- `supabase/tests/` — pgTAP transactional business-rule tests.
- `supabase/functions/tests/` — Deno unit tests for Edge Function validation and notification isolation.
- `frontend/src/test/` — Vitest component tests.

## Traceability

Each requirement below is traced to the primary implementation. Cross-cutting requirements often touch more than one file; companion files are included where needed.

### Functional requirements

| SRS requirement | Implementation |
| --- | --- |
| FR-006, FR-007, FR-010, FR-012 — create and price customer orders | `supabase/functions/create_order/index.ts`; `supabase/functions/_shared/create_order_validation.ts`; `supabase/migrations/202610210002_create_order.sql`; `frontend/src/App.tsx` (`CreateOrderForm`) |
| FR-013, FR-014 — schedule pickup and delivery | `supabase/functions/schedule/index.ts`; `supabase/migrations/202610210003_schedule_order.sql`; `frontend/src/App.tsx` (`ScheduleOrderForm`, `SlotPicker`) |
| FR-016, FR-022, FR-024, FR-025, FR-026, FR-028 — record delivery, item outcomes, exceptions, and invoice | `supabase/functions/record_delivery/index.ts`; `supabase/migrations/202610210004_record_delivery.sql`; `frontend/src/App.tsx` (`RecordDeliveryScreen`) |
| FR-017–FR-021 — LaundryStaff order workflow and processing issues | `supabase/migrations/202610210006_phase_6_workflow_reports.sql`; `frontend/src/App.tsx` (`StaffWorkflow`); `frontend/src/Phase6.css` |
| FR-029 — notifications | `supabase/functions/send_notification/index.ts`; `supabase/functions/_shared/notifications.ts`; `supabase/migrations/202610210005_notifications_gateway.sql` |
| FR-030 — significant status notification/live tracking | `supabase/functions/_shared/notifications.ts`; `supabase/functions/record_delivery/index.ts`; `supabase/functions/schedule/index.ts`; `frontend/src/App.tsx` (`CustomerOrderTracker`); `supabase/migrations/202610210006_phase_6_workflow_reports.sql` |
| FR-033–FR-036 — operational reports | `frontend/src/App.tsx` (`AdminDashboard`); reads `orders` and `invoices` under the Administrator RLS policies in `supabase/migrations/202610210001_phase_1_schema_auth.sql` |

### Business rules

| Business rule | Implementation |
| --- | --- |
| BR-001 — UC-003 authorization precondition (active Customer session) | `supabase/functions/create_order/index.ts` (auth, active `session_log`, Customer role/status checks); `supabase/migrations/202610210001_phase_1_schema_auth.sql`; `frontend/src/App.tsx` (`AuthCard`, `ProtectedHome`) |
| BR-002 — submitted order has at least one item; Order owns items | `supabase/functions/_shared/create_order_validation.ts`; `supabase/migrations/202610210001_phase_1_schema_auth.sql` (composition FK with cascade); `supabase/migrations/202610210002_create_order.sql` |
| BR-003 — both slots reserve together or neither | `supabase/migrations/202610210003_schedule_order.sql` (`schedule_order` locks both rows); `supabase/tests/phase7_business_rules.test.sql` |
| BR-006 — invoice only after delivery, at most one per order | `supabase/migrations/202610210004_record_delivery.sql` (`generate_invoice`); `supabase/tests/phase7_business_rules.test.sql` |
| BR-007 — every item accounted for before Delivered; exceptions require review | `supabase/migrations/202610210004_record_delivery.sql` (`record_delivery`); `supabase/tests/phase7_business_rules.test.sql` |
| BR-010 — notification dispatch failure is retryable and cannot undo business work | `supabase/functions/_shared/notifications.ts`; `supabase/functions/send_notification/index.ts`; `supabase/migrations/202610210005_notifications_gateway.sql`; `supabase/functions/tests/notification_isolation_test.ts` |

### Use cases

| Use case | Implementation and tests |
| --- | --- |
| UC-003 Create Order | `supabase/functions/create_order/index.ts`; `supabase/migrations/202610210002_create_order.sql`; `frontend/src/App.tsx` (`CreateOrderForm`); `frontend/src/test/CreateOrderForm.test.tsx`; `supabase/functions/tests/create_order_validation_test.ts`; `supabase/tests/phase7_business_rules.test.sql` |
| UC-005 Schedule Pickup/Delivery | `supabase/functions/schedule/index.ts`; `supabase/migrations/202610210003_schedule_order.sql`; `frontend/src/App.tsx` (`ScheduleOrderForm`); `supabase/tests/phase7_business_rules.test.sql` |
| UC-010 Record Delivery | `supabase/functions/record_delivery/index.ts`; `supabase/migrations/202610210004_record_delivery.sql`; `frontend/src/App.tsx` (`RecordDeliveryScreen`); `supabase/tests/phase7_business_rules.test.sql` |

The exact eight persisted order states are defined by the `order_status` enum in `supabase/migrations/202610210001_phase_1_schema_auth.sql`: `Created`, `Pickup Scheduled`, `Picked Up`, `In Processing`, `Ready`, `Out for Delivery`, `Delivered`, and `Cancelled`.

## Testing

From `frontend/`, install packages with `npm install`, then run `npm test`, `npm run build`, and `npm run lint`. Vitest tests exercise the Create Order component’s item/price UI and retain-entered-values error behavior.

From the repository root, run the Deno tests with `deno test --allow-env supabase/functions/tests`. They cover Create Order validation and ensure a rejected notification dispatch is swallowed by the fire-and-forget boundary. The database suite uses pgTAP and real transaction semantics; after starting the local Supabase stack, run `supabase test db`. It tests successful creation/scheduling/delivery, invalid and empty order rejection without partial orders, capacity conflicts without one-sided booking, missing/damaged exceptions, and invoice retry idempotence.

## Deployment

### Vercel frontend

Create a Vercel project from this repository with:

- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`
- **Environment variables** (set for Preview and Production):
  - `VITE_SUPABASE_URL` — project URL, e.g. `https://<project-ref>.supabase.co`.
  - `VITE_SUPABASE_ANON_KEY` — that project's publishable/anon key. Never put the service-role key in Vercel frontend variables.

To point a fresh grading/demo deploy at a different Supabase project, set those two Vercel variables to the new project's URL and anon key, then trigger a redeploy. The app’s auth, profiles, and data requests then use the new backend.

### Supabase project

1. Install and authenticate the Supabase CLI, then from the repository root run `supabase login`, `supabase link --project-ref <new-project-ref>`, and `supabase db push`. This applies the ordered migrations. Apply seed data separately with `supabase db reset` only for a disposable local database; do not reset a hosted project to seed it.
2. Deploy Edge Functions: `supabase functions deploy create_order`, `supabase functions deploy schedule`, `supabase functions deploy record_delivery`, and `supabase functions deploy send_notification`.
3. Set Edge Function secrets in the Supabase project (Dashboard → Edge Functions → Secrets, or `supabase secrets set`): `FRONTEND_PRODUCTION_ORIGIN=https://<production-host>`, `VERCEL_PROJECT_SLUG=<vercel-project-slug>`, and optionally `CORS_ALLOWED_ORIGINS` as a comma-separated set of exact extra origins. Set `NOTIFICATION_MOCK_MODE=success` for the mock provider or `failure` to test retryable dispatch failure. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions; the service-role key is server-only.
4. Configure Supabase Auth’s Site URL and redirect URLs to include the production Vercel domain and any preview domains used for sign-in. In Edge Function CORS, the exact production origin is allowed by `FRONTEND_PRODUCTION_ORIGIN`; HTTPS Vercel preview origins are allowed only when their hostname starts with `<VERCEL_PROJECT_SLUG>-` and ends with `.vercel.app`. Add local or custom domains explicitly to `CORS_ALLOWED_ORIGINS`. The shared CORS implementation is `supabase/functions/_shared/cors.ts`.
5. Realtime is enabled in `supabase/config.toml`; migration `202610210006_phase_6_workflow_reports.sql` adds `public.orders` to the `supabase_realtime` publication. For a hosted project, confirm the publication contains `orders` after applying migrations.

### RLS and access summary

RLS is enabled by `supabase/migrations/202610210001_phase_1_schema_auth.sql` and extended in the later migrations. Customers can manage their own orders/items and read their invoices; LaundryStaff can read assigned orders and update their assigned order/item workflow plus record processing issues; DeliveryPersonnel can read assigned orders/items and record delivery exceptions; Administrators have management access across the domain tables and can read reports. Slots are visible to authenticated users while active and are managed by Administrators. RPCs performing multi-row changes use transaction-scoped Postgres functions; Edge Functions additionally check active `session_log` and role/ownership/assignment before calling them.

## Local development

Prerequisites: Node.js/npm, Supabase CLI, and Deno for Edge Function tests. Start the stack with `supabase start`, apply migrations with `supabase db reset` on the local disposable database, copy `frontend/.env.example` to `frontend/.env.local`, and set the local `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Run the web app with `cd frontend; npm install; npm run dev`. See `frontend/README.md` and `supabase/functions/.env.example` for function-specific local settings.
