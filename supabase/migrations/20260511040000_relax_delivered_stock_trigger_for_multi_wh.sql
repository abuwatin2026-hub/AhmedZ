create or replace function public.trg_orders_require_sale_out_on_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    -- Simply check if ANY sale_out stock movement exists for this order.
    -- We removed the strict `warehouse_id = v_wh` check because multi-warehouse
    -- routing allows order items to be fulfilled from different warehouses than the primary order warehouse.
    if not exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = new.id::text
        and im.movement_type = 'sale_out'
    ) then
      raise exception 'cannot mark delivered without stock movements for this order/warehouse';
    end if;
  end if;
  return new;
end;
$$;
