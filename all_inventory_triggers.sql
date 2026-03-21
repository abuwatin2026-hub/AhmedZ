
============================================================
-- TRIGGER FN: RI_FKey_check_ins
============================================================
CREATE OR REPLACE FUNCTION pg_catalog."RI_FKey_check_ins"()
 RETURNS trigger
 LANGUAGE internal
 PARALLEL SAFE STRICT
AS $function$RI_FKey_check_ins$function$


============================================================
-- TRIGGER FN: RI_FKey_check_upd
============================================================
CREATE OR REPLACE FUNCTION pg_catalog."RI_FKey_check_upd"()
 RETURNS trigger
 LANGUAGE internal
 PARALLEL SAFE STRICT
AS $function$RI_FKey_check_upd$function$


============================================================
-- TRIGGER FN: _apply_transfer_in_avg_cost
============================================================
CREATE OR REPLACE FUNCTION public._apply_transfer_in_avg_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.movement_type <> 'transfer_in' then
    return new;
  end if;

  if coalesce(new.reference_table, '') <> 'warehouse_transfers' then
    return new;
  end if;

  if new.warehouse_id is null or new.item_id is null then
    return new;
  end if;

  update public.stock_management sm
  set
    avg_cost = case
      when coalesce(sm.available_quantity, 0) > 0 then
        (
          greatest(coalesce(sm.available_quantity, 0) - coalesce(new.quantity, 0), 0) * coalesce(sm.avg_cost, 0)
          + coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0)
        ) / nullif(coalesce(sm.available_quantity, 0), 0)
      else
        coalesce(new.unit_cost, 0)
    end,
    last_updated = now(),
    updated_at = now()
  where sm.item_id = new.item_id
    and sm.warehouse_id = new.warehouse_id;

  return new;
end;
$function$


============================================================
-- TRIGGER FN: block_writes_during_maintenance
============================================================
CREATE OR REPLACE FUNCTION public.block_writes_during_maintenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_maintenance_on() AND NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Service unavailable during maintenance' USING errcode = 'U0001';
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$function$


============================================================
-- TRIGGER FN: trg_block_sale_below_cost
============================================================
CREATE OR REPLACE FUNCTION public.trg_block_sale_below_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
  v_order jsonb;
  v_line jsonb;
  v_unit_price numeric;
  v_item_id text;
  v_fx numeric;
  v_unit_price_base numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_discount_factor numeric;
  v_invoice_number text;
  v_reason text;
  v_uom_factor numeric := 1;
begin
  if tg_op not in ('INSERT','UPDATE') then
    return new;
  end if;
  if new.movement_type <> 'sale_out' then
    return new;
  end if;
  if new.batch_id is null then
    return new;
  end if;
  if coalesce(new.reference_table,'') <> 'orders' or nullif(coalesce(new.reference_id,''),'') is null then
    return new;
  end if;

  select b.cost_per_unit, b.min_selling_price
  into v_batch
  from public.batches b
  where b.id = new.batch_id;

  select o.data, o.fx_rate
  into v_order, v_fx
  from public.orders o
  where o.id = (new.reference_id)::uuid;
  if v_order is null then
    return new;
  end if;

  v_item_id := new.item_id::text;
  v_unit_price := null;
  v_uom_factor := 1;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_order->'items','[]'::jsonb))
  loop
    if coalesce(nullif(v_line->>'id',''), nullif(v_line->>'itemId','')) = v_item_id then
      begin
        v_unit_price := nullif((v_line->>'price')::numeric, null);
      exception when others then
        v_unit_price := null;
      end;
      begin
        v_uom_factor := greatest(
          coalesce(
            nullif((v_line->>'uomQtyInBase')::numeric, null),
            nullif((v_line->>'uom_qty_in_base')::numeric, null),
            1
          ),
          1
        );
      exception when others then
        v_uom_factor := 1;
      end;
      exit;
    end if;
  end loop;

  if v_unit_price is null then
    return new;
  end if;

  v_discount_factor := 1;
  v_subtotal := 0;
  begin
    v_subtotal := coalesce(nullif((v_order->>'subtotal')::numeric, null), 0);
  exception when others then
    v_subtotal := 0;
  end;
  v_discount := 0;
  begin
    v_discount := coalesce(nullif((v_order->>'discountAmount')::numeric, null), 0);
  exception when others then
    v_discount := 0;
  end;
  if v_discount <= 0 then
    begin
      v_discount := coalesce(nullif((v_order->>'discount_amount')::numeric, null), 0);
    exception when others then
      v_discount := 0;
    end;
  end if;
  if v_subtotal > 0 and v_discount > 0 then
    v_discount_factor := greatest(0, least(1, (v_subtotal - least(v_discount, v_subtotal)) / v_subtotal));
  end if;

  v_unit_price_base := (coalesce(v_unit_price, 0) / greatest(coalesce(v_uom_factor, 1), 1)) * coalesce(v_fx, 1) * coalesce(v_discount_factor, 1);
  if v_unit_price_base + 1e-9 < coalesce(v_batch.min_selling_price, 0) then
    if public.allow_below_cost_sales() then
      v_reason := nullif(btrim(coalesce(v_order->>'belowCostOverrideReason', v_order->>'belowCostReason', '')), '');
      if v_reason is null and not public.is_owner_or_manager() then
        raise exception 'BELOW_COST_REASON_REQUIRED';
      end if;
      if tg_op = 'INSERT' and to_regclass('public.system_audit_logs') is not null then
        select coalesce(v_order->>'invoiceNumber', v_order->'invoiceSnapshot'->>'invoiceNumber', '') into v_invoice_number;
        insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
        values (
          'orders.sell_below_cost',
          'sales',
          coalesce(nullif(btrim(coalesce(new.reference_id, '')), ''), new.id::text),
          auth.uid(),
          now(),
          jsonb_build_object(
            'orderId', new.reference_id,
            'invoiceNumber', coalesce(v_invoice_number, ''),
            'itemId', v_item_id,
            'batchId', new.batch_id::text,
            'unitPrice', v_unit_price,
            'uomQtyInBase', v_uom_factor,
            'fxRate', coalesce(v_fx, 1),
            'discountFactor', coalesce(v_discount_factor, 1),
            'unitPriceBaseNet', v_unit_price_base,
            'batchMinSellingPrice', coalesce(v_batch.min_selling_price, 0),
            'batchCostPerUnit', coalesce(v_batch.cost_per_unit, 0),
            'overrideReason', v_reason
          ),
          'HIGH',
          'SELL_BELOW_COST_OVERRIDE'
        );
      end if;
      return new;
    end if;
    raise exception 'SELLING_BELOW_COST_NOT_ALLOWED';
  end if;

  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_block_sale_on_qc
============================================================
CREATE OR REPLACE FUNCTION public.trg_block_sale_on_qc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qc text;
  v_recall boolean;
begin
  if new.movement_type in ('sale_out','transfer_out') and new.batch_id is not null then
    select qc_status into v_qc from public.batches where id = new.batch_id;
    select exists(
      select 1 from public.batch_recalls br
      where br.batch_id = new.batch_id and br.status = 'active'
    ) into v_recall;
    if v_qc is distinct from 'released' or v_recall then
      raise exception 'batch not released or recalled';
    end if;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_check_simple_date_closed_period
============================================================
CREATE OR REPLACE FUNCTION public.trg_check_simple_date_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_col_name text := TG_ARGV[0];
  v_date_val timestamptz;
begin
  -- Check OLD row on DELETE or UPDATE
  if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') then
    execute format('select ($1).%I', v_col_name) using OLD into v_date_val;
    if public.is_in_closed_period(v_date_val) then
      raise exception 'Cannot modify records in a closed accounting period.';
    end if;
  end if;

  -- Check NEW row on INSERT or UPDATE
  if (TG_OP = 'INSERT' or TG_OP = 'UPDATE') then
    execute format('select ($1).%I', v_col_name) using NEW into v_date_val;
    if public.is_in_closed_period(v_date_val) then
      raise exception 'Cannot create or modify records in a closed accounting period.';
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$function$


============================================================
-- TRIGGER FN: trg_consume_order_item_reservation_on_sale_out
============================================================
CREATE OR REPLACE FUNCTION public.trg_consume_order_item_reservation_on_sale_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_source text;
begin
  if new.reference_table <> 'orders' or new.movement_type <> 'sale_out' then
    return new;
  end if;
  if new.warehouse_id is null then
    return new;
  end if;
  if new.batch_id is null then
    raise exception 'SALE_OUT_CONSUME_REQUIRES_BATCH';
  end if;

  begin
    v_order_id := nullif(new.reference_id, '')::uuid;
  exception when others then
    return new;
  end;

  select coalesce(nullif(o.data->>'orderSource',''), '') into v_source
  from public.orders o
  where o.id = v_order_id;

  if coalesce(v_source, '') = 'in_store' then
    return new;
  end if;

  update public.order_item_reservations
  set quantity = quantity - coalesce(new.quantity, 0),
      updated_at = now()
  where order_id = v_order_id
    and item_id = new.item_id::text
    and warehouse_id = new.warehouse_id
    and batch_id = new.batch_id;

  delete from public.order_item_reservations r
  where r.order_id = v_order_id
    and r.item_id = new.item_id::text
    and r.warehouse_id = new.warehouse_id
    and r.batch_id = new.batch_id
    and r.quantity <= 0;

  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_enforce_writeoff_approval
============================================================
CREATE OR REPLACE FUNCTION public.trg_enforce_writeoff_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_required boolean;
begin
  if new.movement_type in ('wastage_out','adjust_out') then
    v_required := public.approval_required('writeoff', new.total_cost);
    new.requires_approval := v_required;
    if v_required and new.approval_status <> 'approved' then
      raise exception 'writeoff requires approval';
    end if;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_forbid_modify_posted_inventory_movements
============================================================
CREATE OR REPLACE FUNCTION public.trg_forbid_modify_posted_inventory_movements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  begin
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'inventory_movements'
        and je.source_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot modify posted inventory movement; create reversal instead';
    end if;
    return coalesce(new, old);
  end;
  $function$


============================================================
-- TRIGGER FN: trg_inventory_movement_requires_journal_entry
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movement_requires_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public._is_migration_actor() then
    return null;
  end if;

  if new.movement_type in ('transfer_out','transfer_in') then
    return null;
  end if;

  if not exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'inventory_movements'
      and je.source_id = new.id::text
  ) then
    raise exception 'inventory movement requires journal entry';
  end if;

  return null;
end;
$function$


============================================================
-- TRIGGER FN: trg_inventory_movements_ensure_batch_exists
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movements_ensure_batch_exists()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
  v_expiry date;
  v_prod date;
begin
  if new.movement_type <> 'purchase_in' then
    return new;
  end if;
  if new.batch_id is null then
    return new;
  end if;
  if exists (select 1 from public.batches b where b.id = new.batch_id) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed';
  end if;

  v_wh := coalesce(new.warehouse_id, public._resolve_default_warehouse_id());
  v_expiry := case
    when (new.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'expiryDate')::date
    else null
  end;
  v_prod := case
    when (new.data->>'harvestDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'harvestDate')::date
    else null
  end;

  insert into public.batches(
    id,
    item_id,
    receipt_item_id,
    receipt_id,
    warehouse_id,
    batch_code,
    production_date,
    expiry_date,
    quantity_received,
    quantity_consumed,
    unit_cost,
    status,
    locked_at,
    data
  )
  values (
    new.batch_id,
    new.item_id::text,
    null,
    null,
    v_wh,
    null,
    v_prod,
    v_expiry,
    coalesce(new.quantity, 0),
    0,
    coalesce(new.unit_cost, 0),
    'active',
    null,
    jsonb_build_object('autoCreated', true, 'sourceTable', coalesce(new.reference_table, ''), 'sourceId', coalesce(new.reference_id, ''))
  )
  on conflict (id) do nothing;

  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_inventory_movements_purchase_in_defaults
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movements_purchase_in_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
begin
  if new.movement_type = 'purchase_in' then
    if new.batch_id is null then
      raise exception 'purchase_in requires batch_id';
    end if;
    if new.warehouse_id is null then
      v_wh := public._resolve_default_warehouse_id();
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
      new.warehouse_id := v_wh;
    end if;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_inventory_movements_purchase_in_immutable
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movements_purchase_in_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.movement_type = 'purchase_in' or new.movement_type = 'purchase_in' then
    if old.movement_type is distinct from new.movement_type then
      raise exception 'purchase_in is immutable';
    end if;
    if old.quantity is distinct from new.quantity then
      raise exception 'purchase_in is immutable';
    end if;
    if old.batch_id is distinct from new.batch_id then
      raise exception 'purchase_in is immutable';
    end if;
    if old.warehouse_id is distinct from new.warehouse_id then
      raise exception 'purchase_in is immutable';
    end if;
    if (old.data->>'expiryDate') is distinct from (new.data->>'expiryDate') then
      raise exception 'purchase_in is immutable';
    end if;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_inventory_movements_purchase_in_no_delete
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movements_purchase_in_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.movement_type = 'purchase_in' then
    raise exception 'purchase_in is insert-only';
  end if;
  return old;
end;
$function$


============================================================
-- TRIGGER FN: trg_inventory_movements_purchase_in_sync_batch_balances
============================================================
CREATE OR REPLACE FUNCTION public.trg_inventory_movements_purchase_in_sync_batch_balances()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
  v_expiry date;
begin
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_stock_manager('batch_balances_sync');
  end if;

  if new.movement_type <> 'purchase_in' then
    return new;
  end if;
  if new.batch_id is null then
    raise exception 'purchase_in requires batch_id';
  end if;
  v_wh := new.warehouse_id;
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;
  v_expiry := case
    when (new.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'expiryDate')::date
    else null
  end;

  insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
  values (new.item_id::text, new.batch_id, v_wh, new.quantity, v_expiry)
  on conflict (item_id, batch_id, warehouse_id)
  do update set
    quantity = public.batch_balances.quantity + excluded.quantity,
    updated_at = now();

  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_post_inventory_movement
============================================================
CREATE OR REPLACE FUNCTION public.trg_post_inventory_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.post_inventory_movement(new.id);
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_sale_out_require_batch
============================================================
CREATE OR REPLACE FUNCTION public.trg_sale_out_require_batch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_category text;
  v_expiry date;
begin
  if tg_op not in ('INSERT','UPDATE') then
    return new;
  end if;
  if new.movement_type <> 'sale_out' then
    return new;
  end if;
  select mi.category into v_category from public.menu_items mi where mi.id::text = new.item_id;
  if coalesce(v_category,'') = 'food' then
    if new.batch_id is null then
      raise exception 'FOOD_SALE_REQUIRES_BATCH';
    end if;
    select b.expiry_date into v_expiry from public.batches b where b.id = new.batch_id;
    if v_expiry is not null and v_expiry < new.occurred_at::date then
      raise exception 'BATCH_EXPIRED';
    end if;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_set_movement_branch_scope
============================================================
CREATE OR REPLACE FUNCTION public.trg_set_movement_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_set_qty_base_inventory_movements
============================================================
CREATE OR REPLACE FUNCTION public.trg_set_qty_base_inventory_movements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_sync_order_item_cogs_from_sale_out
============================================================
CREATE OR REPLACE FUNCTION public.trg_sync_order_item_cogs_from_sale_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_new uuid;
  v_order_old uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if coalesce(new.reference_table, '') = 'orders' and coalesce(new.movement_type, '') = 'sale_out' then
      if new.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_order_new := new.reference_id::uuid;
      end if;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if coalesce(old.reference_table, '') = 'orders' and coalesce(old.movement_type, '') = 'sale_out' then
      if old.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_order_old := old.reference_id::uuid;
      end if;
    end if;
  end if;

  if v_order_new is not null then
    perform public.sync_order_item_cogs_from_sale_out(v_order_new);
  end if;
  if v_order_old is not null and v_order_old is distinct from v_order_new then
    perform public.sync_order_item_cogs_from_sale_out(v_order_old);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_trace_batch_sales
============================================================
CREATE OR REPLACE FUNCTION public.trg_trace_batch_sales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.movement_type = 'sale_out' and new.batch_id is not null and new.reference_table = 'orders' then
    insert into public.batch_sales_trace(batch_id, order_id, quantity, sold_at)
    values (new.batch_id, new.reference_id::uuid, new.quantity, new.occurred_at);
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_transfer_movement_ensure_batch
============================================================
CREATE OR REPLACE FUNCTION public.trg_transfer_movement_ensure_batch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch_id uuid;
  v_source_batch_id uuid;
  v_ref_prefix text;
  v_shipping_total numeric;
  v_source_unit_cost numeric;
begin
  v_ref_prefix := substring(coalesce(new.reference_id, new.id::text) from 1 for 8);
  v_shipping_total := coalesce(nullif(new.data->>'shippingCostApplied', '')::numeric, 0);

  if new.batch_id is null and new.movement_type = 'transfer_out' then
    begin
      v_source_batch_id := nullif(new.data->>'batchId', '')::uuid;
    exception when others then
      v_source_batch_id := null;
    end;
    if v_source_batch_id is not null then
      if exists (
        select 1
        from public.batches b
        where b.id = v_source_batch_id
          and b.item_id::text = new.item_id::text
          and b.warehouse_id = new.warehouse_id
      ) then
        new.batch_id := v_source_batch_id;
      end if;
    end if;
  end if;

  if new.batch_id is not null then
    select b.unit_cost into v_source_unit_cost from public.batches b where b.id = new.batch_id;
    if coalesce(v_source_unit_cost, 0) > 0 and new.movement_type = 'transfer_out' then
      new.unit_cost := v_source_unit_cost;
      new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
    end if;
    return new;
  end if;

  if new.movement_type not in ('transfer_out', 'transfer_in') then
    return new;
  end if;

  if new.movement_type = 'transfer_in' then
    begin
      v_source_batch_id := nullif(new.data->>'batchId', '')::uuid;
    exception when others then
      v_source_batch_id := null;
    end;

    select b.id
    into v_batch_id
    from public.batches b
    where b.item_id::text = new.item_id::text
      and b.warehouse_id = new.warehouse_id
      and (
        (coalesce(b.data, '{}'::jsonb)->>'autoCreatedForTransfer')::boolean is true
        and coalesce(b.data->>'referenceTable', '') = coalesce(new.reference_table, '')
        and coalesce(b.data->>'referenceId', '') = coalesce(new.reference_id, '')
      )
    order by b.created_at desc
    limit 1;

    if v_batch_id is null then
      select b.id
      into v_batch_id
      from public.batches b
      where b.item_id::text = new.item_id::text
        and b.warehouse_id = new.warehouse_id
        and coalesce(b.batch_code, '') = concat('TRF-AUTO-', v_ref_prefix)
      order by b.created_at desc
      limit 1;
    end if;
  else
    select b.id
    into v_batch_id
    from public.batches b
    where b.item_id::text = new.item_id::text
      and b.warehouse_id = new.warehouse_id
      and coalesce(b.qc_status, 'released') = 'released'
      and not exists (
        select 1
        from public.batch_recalls br
        where br.batch_id = b.id
          and br.status = 'active'
      )
    order by b.created_at asc
    limit 1;
  end if;

  if v_batch_id is null then
    v_batch_id := gen_random_uuid();
    insert into public.batches(
      id,
      item_id,
      warehouse_id,
      batch_code,
      quantity_received,
      quantity_consumed,
      unit_cost,
      cost_per_unit,
      qc_status,
      foreign_currency,
      foreign_unit_cost,
      fx_rate_at_receipt,
      data
    )
    values (
      v_batch_id,
      new.item_id::text,
      new.warehouse_id,
      concat('TRF-AUTO-', v_ref_prefix),
      case when new.movement_type = 'transfer_in' then greatest(coalesce(new.quantity, 0), 0) else 0 end,
      0,
      coalesce(new.unit_cost, 0),
      coalesce(new.unit_cost, 0),
      'released',
      case when v_source_batch_id is null then null else (select foreign_currency from public.batches where id = v_source_batch_id) end,
      case when v_source_batch_id is null then null else (select foreign_unit_cost from public.batches where id = v_source_batch_id) end,
      case when v_source_batch_id is null then null else (select fx_rate_at_receipt from public.batches where id = v_source_batch_id) end,
      jsonb_build_object(
        'autoCreatedForTransfer', true,
        'referenceTable', new.reference_table,
        'referenceId', new.reference_id,
        'movementType', new.movement_type,
        'sourceBatchId', case when v_source_batch_id is null then null else v_source_batch_id::text end
      )
    );
  elsif new.movement_type = 'transfer_in' then
    update public.batches b
    set
      quantity_received = coalesce(b.quantity_received, 0) + greatest(coalesce(new.quantity, 0), 0),
      unit_cost = case
        when coalesce(b.unit_cost, 0) = 0 and coalesce(new.unit_cost, 0) > 0 then new.unit_cost
        else b.unit_cost
      end,
      cost_per_unit = case
        when coalesce(b.cost_per_unit, 0) = 0 and coalesce(new.unit_cost, 0) > 0 then new.unit_cost
        else b.cost_per_unit
      end,
      foreign_currency = coalesce(
        b.foreign_currency,
        case when v_source_batch_id is null then null else (select foreign_currency from public.batches where id = v_source_batch_id) end
      ),
      foreign_unit_cost = coalesce(
        b.foreign_unit_cost,
        case when v_source_batch_id is null then null else (select foreign_unit_cost from public.batches where id = v_source_batch_id) end
      ),
      fx_rate_at_receipt = coalesce(
        b.fx_rate_at_receipt,
        case when v_source_batch_id is null then null else (select fx_rate_at_receipt from public.batches where id = v_source_batch_id) end
      ),
      updated_at = now()
    where b.id = v_batch_id;
  end if;

  new.batch_id := v_batch_id;

  if new.movement_type = 'transfer_in' and v_source_batch_id is not null then
    select b.unit_cost into v_source_unit_cost from public.batches b where b.id = v_source_batch_id;
    if coalesce(v_source_unit_cost, 0) > 0 then
      new.unit_cost := v_source_unit_cost + case when coalesce(new.quantity, 0) > 0 then (v_shipping_total / new.quantity) else 0 end;
      new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
    end if;
  end if;

  return new;
end;
$function$


============================================================
-- TRIGGER FN: trg_validate_purchase_return_consistency_from_movements
============================================================
CREATE OR REPLACE FUNCTION public.trg_validate_purchase_return_consistency_from_movements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_return_id uuid;
  v_ref text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if coalesce(new.movement_type, '') = 'return_out' and coalesce(new.reference_table, '') = 'purchase_returns' then
      v_ref := nullif(new.reference_id::text, '');
      if v_ref is not null and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_return_id := v_ref::uuid;
      end if;
    end if;
  end if;

  if v_return_id is null and tg_op in ('UPDATE', 'DELETE') then
    if coalesce(old.movement_type, '') = 'return_out' and coalesce(old.reference_table, '') = 'purchase_returns' then
      v_ref := nullif(old.reference_id::text, '');
      if v_ref is not null and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_return_id := v_ref::uuid;
      end if;
    end if;
  end if;

  if v_return_id is not null then
    perform public.validate_purchase_return_base_consistency(v_return_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$


============================================================
-- TRIGGER FN: validate_sales_return_inventory_reference
============================================================
CREATE OR REPLACE FUNCTION public.validate_sales_return_inventory_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.reference_table = 'sales_returns' and new.movement_type = 'return_in' then
    if nullif(trim(coalesce(new.reference_id, '')), '') is null then
      raise exception 'sales_returns return_in requires reference_id';
    end if;

    if not exists (
      select 1
      from public.sales_returns sr
      where sr.id::text = new.reference_id
    ) then
      raise exception 'invalid sales_return reference_id: %', new.reference_id;
    end if;
  end if;
  return new;
end;
$function$
