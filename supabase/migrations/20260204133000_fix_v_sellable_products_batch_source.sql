create or replace view public.v_sellable_products as
with stock as (
  select sm.item_id::text as item_id,
         sum(coalesce(sm.available_quantity, 0)) as available_quantity
  from public.stock_management sm
  group by sm.item_id::text
),
valid_batches as (
  select
    b.item_id::text as item_id,
    bool_or(
      greatest(
        coalesce(b.quantity_received, 0)
        - coalesce(b.quantity_consumed, 0)
        - coalesce(b.quantity_transferred, 0),
        0
      ) > 0
      and coalesce(b.status, 'active') = 'active'
      and coalesce(b.qc_status, '') = 'released'
      and not exists (
        select 1 from public.batch_recalls br
        where br.batch_id = b.id and br.status = 'active'
      )
      and (b.expiry_date is null or b.expiry_date >= current_date)
    ) as has_valid_batch
  from public.batches b
  group by b.item_id::text
)
select
  mi.id,
  mi.name,
  mi.barcode,
  mi.price,
  mi.base_unit,
  mi.is_food,
  mi.expiry_required,
  mi.sellable,
  mi.status,
  coalesce(s.available_quantity, 0) as available_quantity,
  mi.category,
  mi.is_featured,
  mi.freshness_level,
  mi.data
from public.menu_items mi
left join stock s on s.item_id = mi.id
left join valid_batches vb on vb.item_id = mi.id
where mi.status = 'active'
  and mi.sellable = true
  and coalesce(s.available_quantity, 0) > 0
  and (mi.expiry_required = false or coalesce(vb.has_valid_batch, false) = true);

alter view public.v_sellable_products set (security_invoker = false);
grant select on public.v_sellable_products to anon, authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
