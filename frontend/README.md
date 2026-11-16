# LaundryHub frontend

## Local setup

1. Start the local Supabase stack from the repository root and apply migrations with `supabase db reset`.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the local Supabase API URL and anon key.
3. Serve the Edge Functions locally with `supabase functions serve --env-file ../supabase/functions/.env.example` (or deploy them to the linked Supabase project).
4. Run `npm install` and `npm run dev` from `frontend`.

## Create order

The customer form calls the `create_order` Edge Function. It requires a valid Supabase Auth token, an active row in `session_log`, and an active Customer profile. The function validates each item, then calls `create_order_atomic`; that Postgres function inserts the order, items, and `ORDER_CREATED` notification in one transaction.

Service rates are set server-side in `supabase/migrations/202610210002_create_order.sql`:

| Service | Unit price |
| --- | ---: |
| Wash & Fold | $5.00 |
| Dry Cleaning | $12.00 |
| Pressing | $4.00 |
| Delicates | $7.50 |

The estimate displayed in the form uses the same rates for review. The database remains authoritative.

## Schedule pickup and delivery

The customer dashboard also calls the `schedule` Edge Function. It accepts only a Created order owned by the active Customer session. The `schedule_order` RPC locks the selected pickup and delivery rows with `FOR UPDATE`, checks capacity for both, then increments both counts and changes the order to `Pickup Scheduled` in one transaction. It records a `SCHEDULE_CONFIRMED` notification with the successful reservation.

Deploy or serve this function alongside `create_order`:

```sh
supabase functions serve schedule --env-file ../supabase/functions/.env.example
```

## Record delivery

Delivery personnel see only orders with their active `StaffAssignment`. For each item they submit an explicit outcome: received, missing, damaged, or failed delivery attempt. The `record_delivery` Edge Function validates the active delivery session and assignment, then calls a single transaction that records handovers or exceptions. Any unresolved exception flags the order for review and leaves its status unchanged. Once every item is received and no unresolved exceptions remain, the order becomes `Delivered`, an idempotent invoice is generated, and the customer receives a `DELIVERY_CONFIRMED` notification.

```sh
supabase functions serve record_delivery --env-file ../supabase/functions/.env.example
```

## Notification gateway and CORS

The `send_notification` Edge Function creates a `pending` notification row, then dispatches through a mock provider interface. Configure `NOTIFICATION_MOCK_MODE=failure` to exercise the retryable `failed` state. Business RPCs no longer insert notifications inside their transactions; their Edge Functions queue gateway calls after the RPC commits. Gateway failures are caught and cannot undo an order, schedule, or delivery update.

Set `FRONTEND_PRODUCTION_ORIGIN` to the exact production site origin and `VERCEL_PROJECT_SLUG` to the Vercel project slug. Edge Function CORS permits that exact production origin and HTTPS preview hostnames beginning with `<project-slug>-` and ending in `.vercel.app`. Add any other exact origins to the comma-separated `CORS_ALLOWED_ORIGINS`. For a hosted Supabase project, set these as Edge Function secrets/configuration values; locally, pass the env example with `--env-file`.

```sh
supabase functions serve send_notification --env-file ../supabase/functions/.env.example
```
