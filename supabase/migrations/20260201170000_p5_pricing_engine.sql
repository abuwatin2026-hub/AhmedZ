do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='batches' and column_name='cost_per_unit'
  ) then
    alter table public.batches add column cost_per_unit numeric not null default 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='batches' and column_name='min_margin_pct'
  ) then
    alter table public.batches add column min_margin_pct numeric not null default 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='batches' and column_name='min_selling_price'
  ) then
    alter table public.batches add column min_selling_price numeric not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'batches_min_margin_pct_check'
  ) then
    alter table public.batches
      add constraint batches_min_margin_pct_check check (min_margin_pct >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'batches_min_selling_price_check'
  ) then
    alter table public.batches
      add constraint batches_min_selling_price_check check (min_selling_price >= 0);
  end if;
end $$;

create or replace function public._resolve_default_min_margin_pct(
  p_item_id text,
  p_warehouse_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_wh jsonb;
  v_settings jsonb;
  v_val numeric;
begin
  if p_item_id is null or btrim(p_item_id) = '' then
    return 0;
  end if;

  select data into v_item from public.menu_items mi where mi.id::text = p_item_id;
  if v_item is not null then
    begin
      v_val := nullif((v_item->'pricing'->>'minMarginPct')::numeric, null);
    exception when others then
      v_val := null;
    end;
    if v_val is not null then
      return greatest(0, v_val);
    end if;
  end if;

  if p_warehouse_id is not null then
    select data into v_wh from public.warehouses w where w.id = p_warehouse_id;
    if v_wh is not null then
      begin
        v_val := nullif((v_wh->'pricing'->>'defaultMinMarginPct')::numeric, null);
      exception when others then
        v_val := null;
      end;
      if v_val is not null then
        return greatest(0, v_val);
      end if;
    end if;
  end if;

  select data into v_settings from public.app_settings where id = 'singleton';
  if v_settings is not null then
    begin
      v_val := nullif((v_settings->'pricing'->>'defaultMinMarginPct')::numeric, null);
    exception when others then
      v_val := null;
    end;
    if v_val is not null then
      return greatest(0, v_val);
    end if;
  end if;

  return 0;
end;
$$;

revoke all on function public._resolve_default_min_margin_pct(text, uuid) from public;
revoke execute on function public._resolve_default_min_margin_pct(text, uuid) from anon;
grant execute on function public._resolve_default_min_margin_pct(text, uuid) to authenticated;

create or replace function public.trg_batches_pricing_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric;
  v_margin numeric;
begin
  v_cost := coalesce(new.cost_per_unit, 0);
  if v_cost <= 0 then
    v_cost := coalesce(new.unit_cost, 0);
  end if;

  if coalesce(new.unit_cost, 0) <= 0 and v_cost > 0 then
    new.unit_cost := v_cost;
  end if;
  new.cost_per_unit := v_cost;

  v_margin := coalesce(new.min_margin_pct, 0);
  if v_margin <= 0 then
    v_margin := public._resolve_default_min_margin_pct(new.item_id, new.warehouse_id);
  end if;
  new.min_margin_pct := greatest(0, v_margin);

  new.min_selling_price := public._money_round(new.cost_per_unit * (1 + (new.min_margin_pct / 100)));
  return new;
end;
$$;

drop trigger if exists trg_batches_pricing_defaults on public.batches;
create trigger trg_batches_pricing_defaults
before insert or update on public.batches
for each row execute function public.trg_batches_pricing_defaults();

create or replace function public.get_fefo_pricing(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric
)
returns table (
  batch_id uuid,
  unit_cost numeric,
  min_price numeric,
  suggested_price numeric,
  batch_code text,
  expiry_date date,
  next_batch_min_price numeric,
  warning_next_batch_price_diff boolean,
  reason_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_batch record;
  v_next record;
  v_base_price numeric := 0;
  v_total_released numeric := 0;
  v_has_nonexpired boolean := false;
  v_has_nonexpired_unreleased boolean := false;
begin
  if p_item_id is null then
    raise exception 'p_item_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select
    b.id,
    b.cost_per_unit,
    b.min_selling_price,
    b.batch_code,
    b.expiry_date,
    greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
  into v_batch
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
    and coalesce(b.qc_status,'released') = 'released'
  order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
  limit 1;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
  ) into v_has_nonexpired;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      and coalesce(b.qc_status,'released') <> 'released'
  ) into v_has_nonexpired_unreleased;

  if v_batch.id is null then
    if v_has_nonexpired_unreleased then
      reason_code := 'BATCH_NOT_RELEASED';
    else
      reason_code := 'NO_VALID_BATCH';
    end if;
    batch_id := null;
    unit_cost := 0;
    min_price := 0;
    suggested_price := 0;
    batch_code := null;
    expiry_date := null;
    next_batch_min_price := null;
    warning_next_batch_price_diff := false;
    return next;
  end if;

  select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
  into v_total_released
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and coalesce(b.qc_status,'released') = 'released';

  if v_total_released + 1e-9 < v_qty then
    reason_code := 'INSUFFICIENT_BATCH_QUANTITY';
  else
    reason_code := null;
  end if;

  v_base_price := public.get_item_price_with_discount(p_item_id, null, v_qty);

  batch_id := v_batch.id;
  unit_cost := coalesce(v_batch.cost_per_unit, 0);
  min_price := coalesce(v_batch.min_selling_price, 0);
  suggested_price := greatest(coalesce(v_base_price, 0), coalesce(v_batch.min_selling_price, 0));
  batch_code := v_batch.batch_code;
  expiry_date := v_batch.expiry_date;

  select
    b.min_selling_price
  into v_next
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
    and coalesce(b.qc_status,'released') = 'released'
    and b.id <> v_batch.id
  order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
  limit 1;

  next_batch_min_price := nullif(coalesce(v_next.min_selling_price, null), null);
  warning_next_batch_price_diff :=
    case
      when next_batch_min_price is null then false
      else abs(next_batch_min_price - min_price) > 1e-9
    end;

  return next;
end;
$$;

revoke all on function public.get_fefo_pricing(uuid, uuid, numeric) from public;
revoke execute on function public.get_fefo_pricing(uuid, uuid, numeric) from anon;
grant execute on function public.get_fefo_pricing(uuid, uuid, numeric) to authenticated;

create or replace function public.get_fefo_pricing(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_customer_id uuid
)
returns table (
  batch_id uuid,
  unit_cost numeric,
  min_price numeric,
  suggested_price numeric,
  batch_code text,
  expiry_date date,
  next_batch_min_price numeric,
  warning_next_batch_price_diff boolean,
  reason_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_base_price numeric := 0;
  v_row record;
begin
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select * into v_row from public.get_fefo_pricing(p_item_id, p_warehouse_id, v_qty);
  batch_id := v_row.batch_id;
  unit_cost := v_row.unit_cost;
  min_price := v_row.min_price;
  batch_code := v_row.batch_code;
  expiry_date := v_row.expiry_date;
  next_batch_min_price := v_row.next_batch_min_price;
  warning_next_batch_price_diff := v_row.warning_next_batch_price_diff;
  reason_code := v_row.reason_code;

  if batch_id is null then
    suggested_price := 0;
    return next;
  end if;

  v_base_price := public.get_item_price_with_discount(p_item_id, p_customer_id, v_qty);
  suggested_price := greatest(coalesce(v_base_price, 0), coalesce(min_price, 0));
  return next;
end;
$$;

revoke all on function public.get_fefo_pricing(uuid, uuid, numeric, uuid) from public;
revoke execute on function public.get_fefo_pricing(uuid, uuid, numeric, uuid) from anon;
grant execute on function public.get_fefo_pricing(uuid, uuid, numeric, uuid) to authenticated;

create or replace function public.trg_block_sale_below_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
  v_order jsonb;
  v_line jsonb;
  v_unit_price numeric;
  v_item_id text;
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

  select o.data into v_order from public.orders o where o.id = (new.reference_id)::uuid;
  if v_order is null then
    return new;
  end if;

  v_item_id := new.item_id::text;
  v_unit_price := null;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_order->'items','[]'::jsonb))
  loop
    if coalesce(nullif(v_line->>'id',''), nullif(v_line->>'itemId','')) = v_item_id then
      begin
        v_unit_price := nullif((v_line->>'price')::numeric, null);
      exception when others then
        v_unit_price := null;
      end;
      exit;
    end if;
  end loop;

  if v_unit_price is null then
    return new;
  end if;

  if v_unit_price + 1e-9 < coalesce(v_batch.min_selling_price, 0) then
    raise exception 'SELLING_BELOW_COST_NOT_ALLOWED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_sale_below_cost on public.inventory_movements;
create trigger trg_block_sale_below_cost
before insert or update on public.inventory_movements
for each row execute function public.trg_block_sale_below_cost();

create or replace function public._resolve_batch_sale_failure_reason(
  p_item_id text,
  p_warehouse_id uuid,
  p_quantity numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_total_released numeric := 0;
  v_has_nonexpired boolean := false;
  v_has_nonexpired_unreleased boolean := false;
begin
  if p_item_id is null or btrim(p_item_id) = '' or p_warehouse_id is null then
    return 'NO_VALID_BATCH';
  end if;
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
  ) into v_has_nonexpired;

  if not v_has_nonexpired then
    return 'NO_VALID_BATCH';
  end if;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      and coalesce(b.qc_status,'released') <> 'released'
  ) into v_has_nonexpired_unreleased;

  if v_has_nonexpired_unreleased then
    return 'BATCH_NOT_RELEASED';
  end if;

  select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
  into v_total_released
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and coalesce(b.qc_status,'released') = 'released';

  if v_total_released + 1e-9 < v_qty then
    return 'INSUFFICIENT_BATCH_QUANTITY';
  end if;

  return null;
end;
$$;

revoke all on function public._resolve_batch_sale_failure_reason(text, uuid, numeric) from public;
revoke execute on function public._resolve_batch_sale_failure_reason(text, uuid, numeric) from anon;
grant execute on function public._resolve_batch_sale_failure_reason(text, uuid, numeric) to authenticated;

create or replace function public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb,
    p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid;
    v_order record;
    v_order_data jsonb;
    v_promos jsonb;
    v_promos_fixed jsonb := '[]'::jsonb;
    v_line jsonb;
    v_snapshot jsonb;
    v_items_all jsonb := '[]'::jsonb;
    v_item jsonb;
    v_final_data jsonb;
    v_is_cod boolean := false;
    v_driver_id uuid;
    v_delivered_at timestamptz;
    v_order_source text;
    v_customer_id uuid;
    v_amount numeric;
    v_customer_type text;
    v_ok boolean;
    v_deposits_paid numeric := 0;
    v_net_ar numeric := 0;
    v_err text;
    v_reason text;
begin
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;
    v_actor := auth.uid();
    v_order_source := '';
    if auth.role() <> 'service_role' then
      if not public.is_staff() then
        raise exception 'not allowed';
      end if;
    end if;
    select *
    into v_order
    from public.orders o
    where o.id = p_order_id
    for update;
    if not found then
      raise exception 'order not found';
    end if;
    v_order_data := coalesce(v_order.data, '{}'::jsonb);
    v_order_source := coalesce(nullif(v_order_data->>'orderSource',''), nullif(p_updated_data->>'orderSource',''), '');
    if auth.role() <> 'service_role' then
      if v_order_source = 'in_store' then
        if not public.has_admin_permission('orders.markPaid') then
          raise exception 'not allowed';
        end if;
      else
        if not (public.has_admin_permission('orders.updateStatus.all') or public.has_admin_permission('orders.updateStatus.delivery')) then
          raise exception 'not allowed';
        end if;
        if public.has_admin_permission('orders.updateStatus.delivery') and not public.has_admin_permission('orders.updateStatus.all') then
          if (v_order_data->>'assignedDeliveryUserId') is distinct from v_actor::text then
            raise exception 'not allowed';
          end if;
        end if;
      end if;
    end if;

    v_customer_id := coalesce(
      nullif(v_order_data->>'customerId','')::uuid,
      nullif(p_updated_data->>'customerId','')::uuid,
      (select c.auth_user_id from public.customers c where c.auth_user_id = v_order.customer_auth_user_id limit 1)
    );
    v_amount := coalesce(nullif((v_order_data->>'total')::numeric, null), nullif((p_updated_data->>'total')::numeric, null), 0);
    if v_customer_id is not null then
      select c.customer_type
      into v_customer_type
      from public.customers c
      where c.auth_user_id = v_customer_id;
    end if;
    if v_customer_type = 'wholesale' then
      v_delivered_at := now();
      select coalesce(sum(p.amount), 0)
      into v_deposits_paid
      from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = p_order_id::text
        and p.direction = 'in'
        and p.occurred_at < v_delivered_at;
      v_deposits_paid := least(greatest(coalesce(v_amount, 0), 0), greatest(coalesce(v_deposits_paid, 0), 0));
      v_net_ar := greatest(0, coalesce(v_amount, 0) - v_deposits_paid);

      select public.check_customer_credit_limit(v_customer_id, v_net_ar)
      into v_ok;
      if not v_ok then
        raise exception 'CREDIT_LIMIT_EXCEEDED';
      end if;
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      p_items := '[]'::jsonb;
    end if;
    v_items_all := p_items;
    v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
    v_is_cod := public._is_cod_delivery_order(v_order_data, v_order.delivery_zone_id);
    if v_is_cod then
      v_driver_id := nullif(coalesce(p_updated_data->>'deliveredBy', p_updated_data->>'assignedDeliveryUserId', v_order_data->>'deliveredBy', v_order_data->>'assignedDeliveryUserId'),'')::uuid;
      if v_driver_id is null then
        raise exception 'delivery_driver_required';
      end if;
    end if;
    if jsonb_typeof(v_promos) = 'array' and jsonb_array_length(v_promos) > 0 then
      if nullif(btrim(coalesce(v_order_data->>'appliedCouponCode', '')), '') is not null then
        raise exception 'promotion_coupon_conflict';
      end if;
      if coalesce(nullif((v_order_data->>'pointsRedeemedValue')::numeric, null), 0) > 0 then
        raise exception 'promotion_points_conflict';
      end if;
      for v_line in select value from jsonb_array_elements(v_promos)
      loop
        v_snapshot := public._compute_promotion_snapshot(
          (v_line->>'promotionId')::uuid,
          null,
          p_warehouse_id,
          coalesce(nullif((v_line->>'bundleQty')::numeric, null), 1),
          null,
          true
        );
        v_snapshot := v_snapshot || jsonb_build_object('promotionLineId', v_line->>'promotionLineId');
        v_promos_fixed := v_promos_fixed || v_snapshot;
        for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb))
        loop
          v_items_all := v_items_all || jsonb_build_object(
            'itemId', v_item->>'itemId',
            'quantity', coalesce(nullif((v_item->>'quantity')::numeric, null), 0)
          );
        end loop;
        insert into public.promotion_usage(
          promotion_id,
          promotion_line_id,
          order_id,
          bundle_qty,
          channel,
          warehouse_id,
          snapshot,
          created_by
        )
        values (
          (v_snapshot->>'promotionId')::uuid,
          (v_snapshot->>'promotionLineId')::uuid,
          p_order_id,
          coalesce(nullif((v_snapshot->>'bundleQty')::numeric, null), 1),
          'in_store',
          p_warehouse_id,
          v_snapshot,
          auth.uid()
        )
        on conflict (promotion_line_id) do nothing;
      end loop;
      v_items_all := public._merge_stock_items(v_items_all);
    else
      v_items_all := public._merge_stock_items(v_items_all);
    end if;

    if jsonb_array_length(v_items_all) = 0 then
      v_items_all := public._extract_stock_items_from_order_data(v_order_data);
    end if;
    if jsonb_array_length(v_items_all) = 0 then
      raise exception 'no deliverable items';
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = p_order_id::text
        and im.movement_type = 'sale_out'
    ) then
      update public.orders
      set status = 'delivered',
          data = p_updated_data,
          updated_at = now()
      where id = p_order_id;
      return;
    end if;

    begin
      perform public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);
    exception when others then
      v_err := coalesce(sqlerrm, '');
      if v_err = 'SELLING_BELOW_COST_NOT_ALLOWED' then
        raise;
      end if;
      if v_err ilike '%batch not released or recalled%' then
        raise exception 'BATCH_NOT_RELEASED';
      end if;
      if v_err = 'BATCH_EXPIRED' then
        raise exception 'NO_VALID_BATCH';
      end if;
      if v_err ilike '%insufficient%' or v_err ilike '%INSUFFICIENT%' then
        v_reason := null;
        for v_item in select value from jsonb_array_elements(coalesce(v_items_all,'[]'::jsonb))
        loop
          v_reason := public._resolve_batch_sale_failure_reason(
            coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id','')),
            p_warehouse_id,
            coalesce(nullif((v_item->>'quantity')::numeric, null), coalesce(nullif((v_item->>'qty')::numeric, null), 0))
          );
          if v_reason is not null then
            raise exception '%', v_reason;
          end if;
        end loop;
        raise exception 'INSUFFICIENT_BATCH_QUANTITY';
      end if;
      raise;
    end;

    v_final_data := coalesce(p_updated_data, v_order_data);
    if jsonb_array_length(v_promos_fixed) > 0 then
      v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos_fixed, true);
    end if;
    if v_is_cod then
      v_final_data := v_final_data - 'paidAt';
      v_driver_id := nullif(v_final_data->>'deliveredBy','')::uuid;
      if v_driver_id is null then
        v_driver_id := nullif(v_final_data->>'assignedDeliveryUserId','')::uuid;
      end if;
      if v_driver_id is not null then
        v_delivered_at := coalesce(nullif(v_final_data->>'deliveredAt','')::timestamptz, now());
        perform public.cod_post_delivery(p_order_id, v_driver_id, v_delivered_at);
      end if;
    end if;
    update public.orders
    set status = 'delivered',
        data = v_final_data,
        updated_at = now()
    where id = p_order_id;
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
