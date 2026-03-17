-- =============================================================================
-- Deploy / Re-deploy get_batch_recall_orders with extended signature
--
-- The frontend (ProductReports.tsx) calls this RPC with 3 parameters:
--   p_batch_id    uuid
--   p_warehouse_id uuid  (optional)
--   p_branch_id   uuid   (optional)
--
-- The previous migration (20260201092000) only created a 1-param version.
-- This migration creates the overloaded 3-param version alongside what exists.
--
-- Applied: 2026-03-17
-- =============================================================================

-- Drop old 1-param version if it exists (prevents overload confusion)
drop function if exists public.get_batch_recall_orders(uuid);
-- Drop old 3-param version if return type changed
drop function if exists public.get_batch_recall_orders(uuid, uuid, uuid);

-- Create with full 3-param signature
create or replace function public.get_batch_recall_orders(
  p_batch_id     uuid,
  p_warehouse_id uuid default null,
  p_branch_id    uuid default null
)
returns table (
  order_id       uuid,
  sold_at        timestamptz,
  warehouse_id   uuid,
  branch_id      uuid,
  item_id        text,
  item_name      jsonb,
  batch_id       uuid,
  expiry_date    date,
  supplier_name  text,
  quantity       numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  return query
  select
    (im.reference_id)::uuid                        as order_id,
    im.occurred_at                                  as sold_at,
    im.warehouse_id                                 as warehouse_id,
    -- Resolve branch from warehouse if available
    coalesce(
      wh.branch_id,
      null
    )                                               as branch_id,
    im.item_id::text                                as item_id,
    coalesce(mi.data->'name', '{}'::jsonb)          as item_name,
    im.batch_id                                     as batch_id,
    b.expiry_date                                   as expiry_date,
    s.name                                          as supplier_name,
    im.quantity                                     as quantity
  from public.inventory_movements im
  join public.menu_items mi on mi.id::text = im.item_id::text
  join public.batches b on b.id = im.batch_id
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  -- Try to get branch from warehouses table if it exists
  left join lateral (
    select w.branch_id
    from public.warehouses w
    where w.id = im.warehouse_id
    limit 1
  ) wh on true
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.batch_id = p_batch_id
    and (p_warehouse_id is null or im.warehouse_id = p_warehouse_id)
  order by im.occurred_at desc;
end;
$$;

revoke all  on function public.get_batch_recall_orders(uuid, uuid, uuid) from public;
revoke execute on function public.get_batch_recall_orders(uuid, uuid, uuid) from anon;
grant execute on function public.get_batch_recall_orders(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
