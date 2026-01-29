create or replace function public.confirm_order_delivery_with_credit(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_amount numeric;
  v_customer_type text;
  v_ok boolean;
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;

  select
    coalesce(
      nullif(o.data->>'customerId','')::uuid,
      nullif(p_updated_data->>'customerId','')::uuid,
      o.customer_auth_user_id
    ),
    coalesce(nullif((o.data->>'total')::numeric, null), nullif((p_updated_data->>'total')::numeric, null), 0)
  into v_customer_id, v_amount
  from public.orders o
  where o.id = p_order_id;

  if v_customer_id is not null then
    select c.customer_type
    into v_customer_type
    from public.customers c
    where c.auth_user_id = v_customer_id;
  end if;

  if v_customer_type = 'wholesale' then
    select public.check_customer_credit_limit(v_customer_id, v_amount)
    into v_ok;
    if not v_ok then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;

  perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) to authenticated;

select pg_sleep(1);
notify pgrst, 'reload schema';
