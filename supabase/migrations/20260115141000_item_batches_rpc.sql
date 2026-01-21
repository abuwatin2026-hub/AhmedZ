create or replace function public.get_item_batches(p_item_id uuid)
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
begin
  return query
  with purchases as (
    select
      im.batch_id,
      im.occurred_at,
      im.unit_cost,
      im.quantity as received_qty
    from public.inventory_movements im
    where im.item_id = p_item_id::text
      and im.movement_type = 'purchase_in'
      and im.batch_id is not null
  ),
  consumed as (
    select
      im.batch_id,
      sum(im.quantity) as consumed_qty
    from public.inventory_movements im
    where im.item_id = p_item_id::text
      and im.movement_type in ('sale_out','wastage_out','adjust_out','return_out')
      and im.batch_id is not null
    group by im.batch_id
  )
  select
    p.batch_id,
    p.occurred_at,
    coalesce(p.unit_cost, 0) as unit_cost,
    coalesce(p.received_qty, 0) as received_quantity,
    coalesce(c.consumed_qty, 0) as consumed_quantity,
    greatest(coalesce(p.received_qty, 0) - coalesce(c.consumed_qty, 0), 0) as remaining_quantity
  from purchases p
  left join consumed c on c.batch_id = p.batch_id
  order by p.occurred_at desc;
end;
$$;
revoke all on function public.get_item_batches(uuid) from public;
grant execute on function public.get_item_batches(uuid) to anon, authenticated;
