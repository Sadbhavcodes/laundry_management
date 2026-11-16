-- Migration: Add trigger/function to automatically notify customer on order status changes
-- Specifically: When laundry staff marks status as 'Ready' ("laundry is done, pick up laundry"),
-- 'In Processing', or 'Picked Up'.
-- This fulfills FR-029/FR-030 and real-time email/in-app customer alerts.

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text;
  v_notification_type text;
begin
  -- Only notify when status has actually changed
  if old.status is distinct from new.status then
    if new.status = 'Ready' then
      v_notification_type := 'ORDER_READY';
      v_message := 'Good news! Your laundry is clean and ready. Please pick up your laundry or prepare for scheduled delivery.';
    elsif new.status = 'In Processing' then
      v_notification_type := 'ORDER_PROCESSING';
      v_message := 'Your laundry is currently being washed and processed by our laundry team.';
    elsif new.status = 'Picked Up' then
      v_notification_type := 'ORDER_PROCESSING';
      v_message := 'Your laundry items have been picked up and arrived at LaundryHub.';
    elsif new.status = 'Out for Delivery' then
      v_notification_type := 'ORDER_PROCESSING';
      v_message := 'Your clean laundry is out for delivery with our delivery driver.';
    else
      return new;
    end if;

    -- Insert notification record directly into notifications table
    -- Realtime and in-app Notification Center will instantly reflect this to the customer
    insert into public.notifications (
      recipient_id,
      order_id,
      notification_type,
      message,
      delivery_status
    ) values (
      new.customer_id,
      new.id,
      v_notification_type,
      v_message,
      'sent'
    );
  end if;

  return new;
end;
$$;

-- Drop if exists and attach trigger
drop trigger if exists trg_notify_order_status_change on public.orders;
create trigger trg_notify_order_status_change
  after update of status on public.orders
  for each row
  execute function public.notify_order_status_change();
