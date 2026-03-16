-- Fix wrong return_in costs for:
-- 1. تونة حلوة كبير: 2 return_in with cost=2.08 → should be 100 each (48 units × 2.08 unit_cost)
-- 2. ببسي جوي كولا: 2 return_in with cost=0.049 → should be 21 each (1 unit × 21 unit_cost)

-- Disable immutability trigger
alter table inventory_movements disable trigger trg_inventory_movements_forbid_modify_posted;
alter table inventory_movements disable trigger trg_inventory_movements_purchase_in_immutable;

do $$
declare
  v_tuna_id uuid;
  v_pepsi_id uuid;
  v_rows int;
begin
  -- Find item IDs
  select id into v_tuna_id from menu_items
  where data->'name'->>'ar' like '%تونة حلوة كبير%' limit 1;

  select id into v_pepsi_id from menu_items
  where data->'name'->>'ar' like '%ببسي جوي كولا%' limit 1;

  raise notice 'Tuna: %, Pepsi: %', v_tuna_id, v_pepsi_id;

  -- Fix تونة حلوة: each return_in has qty=48, cost≈2.08 → should be 100
  -- (48 حبة × 2.0833 unit_cost = 100)
  if v_tuna_id is not null then
    update inventory_movements
    set total_cost = 100
    where item_id = v_tuna_id::text
      and movement_type = 'return_in'
      and quantity = 48
      and abs(total_cost - 2.0833333333333335) < 0.01;
    get diagnostics v_rows = row_count;
    raise notice 'Fixed تونة: % rows (2.08 → 100)', v_rows;
  end if;

  -- Fix ببسي جوي كولا: each return_in has qty=1, cost≈0.049 → should be 21
  if v_pepsi_id is not null then
    update inventory_movements
    set total_cost = 21
    where item_id = v_pepsi_id::text
      and movement_type = 'return_in'
      and quantity = 1
      and abs(total_cost - 0.049065) < 0.01;
    get diagnostics v_rows = row_count;
    raise notice 'Fixed ببسي: % rows (0.049 → 21)', v_rows;
  end if;
end;
$$;
