set app.allow_ledger_ddl = '1';

create or replace function public.get_item_cost_layers_summaries(
  p_warehouse_id uuid,
  p_item_ids text[]
)
returns table(
  item_id text,
  layers_count int,
  distinct_costs int,
  total_remaining numeric,
  min_unit_cost numeric,
  max_unit_cost numeric,
  weighted_avg_unit_cost numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item_id text;
  v_is_food boolean;
begin
  perform public._require_staff('get_item_cost_layers_summaries');
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return;
  end if;

  foreach v_item_id in array p_item_ids
  loop
    if v_item_id is null or btrim(v_item_id) = '' then
      continue;
    end if;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;
    v_is_food := coalesce(v_is_food, false);

    return query
    with base as (
      select
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )::numeric as remaining_qty,
        coalesce(b.unit_cost, 0)::numeric as unit_cost
      from public.batches b
      where b.item_id::text = v_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status,'active') = 'active'
        and coalesce(b.qc_status,'') = 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        ) > 0
        and (
          not v_is_food
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
    )
    select
      v_item_id::text as item_id,
      count(*)::int as layers_count,
      count(distinct round(unit_cost, 6))::int as distinct_costs,
      coalesce(sum(remaining_qty), 0)::numeric as total_remaining,
      coalesce(min(unit_cost), 0)::numeric as min_unit_cost,
      coalesce(max(unit_cost), 0)::numeric as max_unit_cost,
      case
        when coalesce(sum(remaining_qty), 0) > 0 then
          (sum(remaining_qty * unit_cost) / sum(remaining_qty))::numeric
        else 0
      end as weighted_avg_unit_cost
    from base;
  end loop;
end;
$$;

revoke all on function public.get_item_cost_layers_summaries(uuid, text[]) from public;
revoke execute on function public.get_item_cost_layers_summaries(uuid, text[]) from anon;
grant execute on function public.get_item_cost_layers_summaries(uuid, text[]) to authenticated, service_role;

create or replace function public.list_item_cost_layers(
  p_item_id text,
  p_warehouse_id uuid,
  p_limit int default 12
)
returns table(
  batch_id uuid,
  batch_code text,
  expiry_date date,
  remaining_qty numeric,
  unit_cost numeric,
  received_at timestamptz,
  receipt_id uuid,
  purchase_order_id uuid,
  purchase_order_ref text,
  import_shipment_id uuid,
  import_shipment_ref text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_food boolean;
begin
  perform public._require_staff('list_item_cost_layers');
  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'item_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  p_limit := greatest(1, least(coalesce(p_limit, 12), 100));

  select (coalesce(mi.category,'') = 'food')
  into v_is_food
  from public.menu_items mi
  where mi.id::text = p_item_id::text;
  v_is_food := coalesce(v_is_food, false);

  return query
  select
    b.id as batch_id,
    coalesce(nullif(btrim(b.batch_code), ''), b.id::text) as batch_code,
    b.expiry_date,
    greatest(
      coalesce(b.quantity_received,0)
      - coalesce(b.quantity_consumed,0)
      - coalesce(b.quantity_transferred,0),
      0
    )::numeric as remaining_qty,
    coalesce(b.unit_cost, 0)::numeric as unit_cost,
    pr.received_at,
    b.receipt_id,
    pr.purchase_order_id,
    coalesce(po.reference_number, pr.purchase_order_id::text) as purchase_order_ref,
    pr.import_shipment_id,
    coalesce(s.reference_number, pr.import_shipment_id::text) as import_shipment_ref
  from public.batches b
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.import_shipments s on s.id = pr.import_shipment_id
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status,'active') = 'active'
    and coalesce(b.qc_status,'') = 'released'
    and not exists (
      select 1 from public.batch_recalls br
      where br.batch_id = b.id and br.status = 'active'
    )
    and greatest(
      coalesce(b.quantity_received,0)
      - coalesce(b.quantity_consumed,0)
      - coalesce(b.quantity_transferred,0),
      0
    ) > 0
    and (
      not v_is_food
      or (b.expiry_date is not null and b.expiry_date >= current_date)
    )
  order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_item_cost_layers(text, uuid, int) from public;
revoke execute on function public.list_item_cost_layers(text, uuid, int) from anon;
grant execute on function public.list_item_cost_layers(text, uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';

