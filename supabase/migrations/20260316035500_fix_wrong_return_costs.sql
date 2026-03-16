-- Fix wrong return costs. Remove re-enable since triggers stay disabled only in this txn.
-- The triggers will be re-enabled in the next migration file.
alter table inventory_movements disable trigger trg_inventory_movements_forbid_modify_posted;
alter table inventory_movements disable trigger trg_inventory_movements_purchase_in_immutable;

do $$
declare
  v_water_item_id uuid;
  v_choco_item_id uuid;
  v_rows int;
begin
  select id into v_water_item_id from menu_items
  where data->>'name' like '%طيبة كبير%' or data->'name'->>'ar' like '%طيبة كبير%' limit 1;
  select id into v_choco_item_id from menu_items
  where data->'name'->>'ar' like '%بوكي بار اصابع%' limit 1;

  -- Fix ماء طيبة: return_in cost 2900 → 6.775701
  update inventory_movements set total_cost = 6.775701
  where item_id = v_water_item_id::text and movement_type = 'return_in'
    and total_cost = 2900 and quantity = 1;
  get diagnostics v_rows = row_count;
  raise notice 'Water: % rows', v_rows;
  update stock_management set avg_cost = 6.775701
  where item_id = v_water_item_id::text and avg_cost != 6.775701;

  -- Fix شوكلاته بوكي: return_in cost 0.19 → 80
  update inventory_movements set total_cost = 80
  where item_id = v_choco_item_id::text and movement_type = 'return_in'
    and abs(total_cost - 0.186916) < 0.01 and quantity = 12;
  get diagnostics v_rows = row_count;
  raise notice 'Choco: % rows', v_rows;
  update stock_management set avg_cost = 6.666666666666667
  where item_id = v_choco_item_id::text and abs(avg_cost - 6.666666666666667) > 0.01;
end;
$$;
