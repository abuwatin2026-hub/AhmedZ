-- Upgrade manage_menu_item_stock to support optional batch tracking
-- and ensure inventory_movements has batch_id for accurate linkage.
-- Idempotent: uses IF NOT EXISTS and CREATE OR REPLACE.

-- 1) Ensure inventory_movements has batch_id column
alter table public.inventory_movements
  add column if not exists batch_id uuid;

-- 2) Ensure stock_history has explicit columns used by UI
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'stock_history' and column_name = 'quantity'
  ) then
    alter table public.stock_history add column quantity numeric;
  end if;

  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'stock_history' and column_name = 'unit'
  ) then
    alter table public.stock_history add column unit text;
  end if;

  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'stock_history' and column_name = 'reason'
  ) then
    alter table public.stock_history add column reason text;
  end if;
end $$;

-- 3) Create or replace function with p_batch_id support
create or replace function public.manage_menu_item_stock(
  p_item_id uuid,
  p_quantity numeric,
  p_unit text,
  p_reason text,
  p_user_id uuid default auth.uid(),
  p_low_stock_threshold numeric default 5,
  p_is_wastage boolean default false,
  p_batch_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_quantity numeric;
  v_old_reserved numeric;
  v_old_avg_cost numeric;
  v_diff numeric;
  v_history_id uuid;
  v_movement_id uuid;
  v_movement_type text;
  v_current_stock record;
begin
  -- Fetch current stock
  select * into v_current_stock
  from public.stock_management
  where item_id = p_item_id;

  v_old_quantity := coalesce(v_current_stock.available_quantity, 0);
  v_old_reserved := coalesce(v_current_stock.reserved_quantity, 0);
  v_old_avg_cost := coalesce(v_current_stock.avg_cost, 0);
  v_diff := p_quantity - v_old_quantity;

  -- Upsert stock_management (preserve reserved)
  insert into public.stock_management (
    item_id,
    available_quantity,
    reserved_quantity,
    unit,
    low_stock_threshold,
    avg_cost,
    last_updated,
    updated_at,
    data
  ) values (
    p_item_id,
    p_quantity,
    v_old_reserved,
    p_unit,
    p_low_stock_threshold,
    v_old_avg_cost,
    now(),
    now(),
    coalesce(v_current_stock.data, '{}'::jsonb) || jsonb_build_object(
      'availableQuantity', p_quantity,
      'unit', p_unit,
      'lowStockThreshold', p_low_stock_threshold,
      'lastUpdated', now()
    )
  )
  on conflict (item_id) do update set
    available_quantity = excluded.available_quantity,
    unit = excluded.unit,
    low_stock_threshold = excluded.low_stock_threshold,
    last_updated = excluded.last_updated,
    updated_at = excluded.updated_at,
    data = excluded.data;

  -- Mirror to menu_items.data.availableStock for UI consistency
  update public.menu_items
  set data = jsonb_set(data, '{availableStock}', to_jsonb(p_quantity)),
      updated_at = now()
  where id = p_item_id::text;

  -- Stock history (UI needs explicit fields)
  v_history_id := gen_random_uuid();
  insert into public.stock_history (id, item_id, quantity, unit, reason, date, data)
  values (
    v_history_id,
    p_item_id,
    p_quantity,
    p_unit,
    p_reason,
    now(),
    jsonb_build_object('changedBy', p_user_id, 'diff', v_diff)
      || (case when p_batch_id is not null then jsonb_build_object('batchId', p_batch_id) else '{}'::jsonb end)
  );

  -- Inventory movement + accounting post
  if v_diff <> 0 then
    if p_is_wastage then
      v_movement_type := 'wastage_out';
    elsif v_diff > 0 then
      v_movement_type := 'adjust_in';
    else
      v_movement_type := 'adjust_out';
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id
    )
    values (
      p_item_id, v_movement_type, abs(v_diff), v_old_avg_cost, abs(v_diff) * v_old_avg_cost,
      'stock_history', v_history_id::text, now(), p_user_id,
      jsonb_build_object('reason', p_reason, 'fromQuantity', v_old_quantity, 'toQuantity', p_quantity)
        || (case when p_batch_id is not null then jsonb_build_object('batchId', p_batch_id) else '{}'::jsonb end),
      p_batch_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end if;

  -- Unified audit log
  insert into public.system_audit_logs (action, module, details, performed_by, performed_at, metadata)
  values (
    case when p_is_wastage then 'wastage_recorded' else 'stock_update' end,
    'stock',
    p_reason,
    p_user_id,
    now(),
    jsonb_build_object('itemId', p_item_id, 'oldQuantity', v_old_quantity, 'newQuantity', p_quantity, 'diff', v_diff, 'unit', p_unit)
      || (case when p_batch_id is not null then jsonb_build_object('batchId', p_batch_id) else '{}'::jsonb end)
  );
end;
$$;
revoke all on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) from public;
grant execute on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) to anon, authenticated;

