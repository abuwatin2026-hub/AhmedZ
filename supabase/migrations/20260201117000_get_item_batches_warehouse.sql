drop function if exists public.get_item_batches(uuid);

create or replace function public.get_item_batches(
  p_item_id uuid,
  p_warehouse_id uuid default null
)
returns table (
  batch_id uuid,
  occurred_at timestamptz,
  unit_cost numeric,
  received_quantity numeric,
  consumed_quantity numeric,
  remaining_quantity numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  perform public._require_staff('get_item_batches');

  v_wh := coalesce(p_warehouse_id, public._resolve_default_admin_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  return query
  select
    b.id as batch_id,
    max(im.occurred_at) as occurred_at,
    max(im.unit_cost) as unit_cost,
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end) as received_quantity,
    sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end) as consumed_quantity,
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end)
      - sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end) as remaining_quantity
  from public.inventory_movements im
  join public.batches b on b.id = im.batch_id
  where b.item_id::uuid = p_item_id
    and b.warehouse_id = v_wh
    and im.batch_id is not null
  group by b.id
  having (
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end)
      - sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end)
  ) > 0
  order by occurred_at desc;
end;
$$;

revoke all on function public.get_item_batches(uuid, uuid) from public;
grant execute on function public.get_item_batches(uuid, uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
