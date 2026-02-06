create or replace function public.get_item_price_with_discount(
  p_item_id text,
  p_customer_id uuid default null,
  p_quantity numeric default 1
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_uuid uuid;
begin
  v_item_uuid := public._uuid_or_null(p_item_id);
  if v_item_uuid is null then
    raise exception 'Invalid item id (expected UUID): %', coalesce(p_item_id, '');
  end if;
  return public.get_item_price_with_discount(v_item_uuid, p_customer_id, p_quantity);
end;
$$;

revoke all on function public.get_item_price_with_discount(text, uuid, numeric) from public;
grant execute on function public.get_item_price_with_discount(text, uuid, numeric) to anon, authenticated;
