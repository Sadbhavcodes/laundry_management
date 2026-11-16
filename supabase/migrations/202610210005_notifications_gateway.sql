-- NotificationGateway dispatch is outside the order/schedule/delivery transaction.
-- Remove the inline notification writes from the existing RPC definitions without
-- changing their transactional business behavior.
do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_original text;
begin
  v_signature := 'public.create_order_atomic(jsonb,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_original := v_definition;
  v_definition := replace(v_definition, E'  insert into public.notifications (recipient_id, order_id, notification_type, message)\n  values (v_user_id, v_order_id, ''ORDER_CREATED'', ''Your laundry order has been created.'');\n\n', '');
  if v_definition = v_original then raise exception 'Could not detach ORDER_CREATED notification from create_order_atomic'; end if;
  execute v_definition;

  v_signature := 'public.schedule_order(uuid,uuid,uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_original := v_definition;
  v_definition := replace(v_definition, E'  insert into public.notifications (recipient_id, order_id, notification_type, message)\n  values (v_user_id, p_order_id, ''SCHEDULE_CONFIRMED'', ''Your pickup and delivery slots are confirmed.'');\n\n', '');
  if v_definition = v_original then raise exception 'Could not detach SCHEDULE_CONFIRMED notification from schedule_order'; end if;
  execute v_definition;

  v_signature := 'public.record_delivery(uuid,jsonb,uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_original := v_definition;
  v_definition := replace(v_definition, E'    insert into public.notifications (recipient_id, order_id, notification_type, message)\n    values (v_order.customer_id, p_order_id, ''DELIVERY_EXCEPTION'', ''A delivery exception was recorded and requires review.'');\n', '');
  v_definition := replace(v_definition, E'  insert into public.notifications (recipient_id, order_id, notification_type, message)\n  values (v_order.customer_id, p_order_id, ''DELIVERY_CONFIRMED'', ''Your laundry order has been delivered.'');\n\n', '');
  if v_definition = v_original then raise exception 'Could not detach delivery notifications from record_delivery'; end if;
  execute v_definition;
end;
$$;
