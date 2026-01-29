-- Phase 6: Admin-created customers (RPC/Edge) and credit sales guard
-- Strict constraints:
-- - No modification to existing RLS
-- - Additions via SECURITY DEFINER only
-- - Preserve existing behavior for Retail and POS
-- - Keep stock.manage as Legacy Super Role (frontend fallback only)

-- 1) Confirm delivery with credit check (wholesale only)
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
  -- Extract linked customer_id: online via orders.customer_auth_user_id, in-store via data->>'customerId'
  select coalesce(o.customer_auth_user_id, nullif(o.data->>'customerId','')::uuid)
  into v_customer_id
  from public.orders o
  where o.id = p_order_id;

  v_amount := coalesce((p_updated_data->>'total')::numeric, 0);

  if v_customer_id is not null then
    select customer_type
    into v_customer_type
    from public.customers
    where auth_user_id = v_customer_id;
  end if;

  -- Only wholesale customers are subject to credit check
  if v_customer_type = 'wholesale' then
    select public.check_customer_credit_limit(v_customer_id, v_amount)
    into v_ok;
    if not v_ok then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;

  -- Defer to canonical delivery RPC
  perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from public;
grant execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) to authenticated;

comment on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid)
is 'Phase 6: Wholesale credit guard at delivery. Retail unaffected. Calls confirm_order_delivery after passing credit check.';

-- 2) Helper: normalize customer type (optional, safe no-op for Retail)
create or replace function public.get_order_customer_type(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.customer_type
  from public.orders o
  join public.customers c on c.auth_user_id = coalesce(o.customer_auth_user_id, nullif(o.data->>'customerId','')::uuid)
  where o.id = p_order_id
$$;

revoke all on function public.get_order_customer_type(uuid) from public;
grant execute on function public.get_order_customer_type(uuid) to authenticated;

