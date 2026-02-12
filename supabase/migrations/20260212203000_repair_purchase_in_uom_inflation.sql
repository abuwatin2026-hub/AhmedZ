set app.allow_ledger_ddl = '1';

create or replace function public.detect_purchase_in_uom_inflation(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_limit int default 200
)
returns table(
  movement_id uuid,
  occurred_at timestamptz,
  item_id text,
  reference_table text,
  reference_id text,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric,
  expected_unit_cost numeric,
  expected_total_cost numeric,
  inflation_factor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_staff('detect_purchase_in_uom_inflation');
  p_limit := greatest(1, least(coalesce(p_limit, 200), 2000));

  return query
  with mv as (
    select
      im.*,
      case when im.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then im.reference_id::uuid else null end as ref_uuid,
      public.uuid_from_text(concat('uomfix:purchase_in:', im.id::text)) as fix_source_uuid
    from public.inventory_movements im
    where im.movement_type = 'purchase_in'
      and coalesce(im.reference_table,'') in ('purchase_orders','purchase_receipts')
      and (p_start is null or im.occurred_at >= p_start)
      and (p_end is null or im.occurred_at <= p_end)
    order by im.occurred_at desc, im.id desc
    limit p_limit
  ),
  joined as (
    select
      mv.id as movement_id,
      mv.occurred_at,
      mv.item_id,
      mv.reference_table,
      mv.reference_id,
      mv.quantity,
      mv.unit_cost,
      mv.total_cost,
      mv.warehouse_id,
      mv.data,
      mv.fix_source_uuid,
      pr.purchase_order_id as receipt_po_id,
      pi.qty_base as pi_qty_base,
      pi.quantity as pi_qty,
      pi.unit_cost_base as pi_unit_cost_base,
      pi.unit_cost as pi_unit_cost,
      pi.uom_id as pi_uom_id,
      mi.transport_cost as mi_transport_cost,
      mi.supply_tax_cost as mi_supply_tax_cost,
      pri.transport_cost as pri_transport_cost,
      pri.supply_tax_cost as pri_supply_tax_cost
    from mv
    left join public.purchase_receipts pr
      on mv.reference_table = 'purchase_receipts' and pr.id = mv.ref_uuid
    left join public.purchase_items pi
      on (
        (mv.reference_table = 'purchase_orders' and pi.purchase_order_id = mv.ref_uuid)
        or (mv.reference_table = 'purchase_receipts' and pr.purchase_order_id is not null and pi.purchase_order_id = pr.purchase_order_id)
      )
      and pi.item_id = mv.item_id
    left join public.menu_items mi on mi.id = mv.item_id
    left join public.purchase_receipt_items pri
      on mv.reference_table = 'purchase_receipts'
      and pri.receipt_id = mv.ref_uuid
      and pri.item_id = mv.item_id
  ),
  calc as (
    select
      j.*,
      greatest(
        coalesce(j.pi_qty_base, j.pi_qty, j.quantity, 0),
        0
      )::numeric as expected_qty_base,
      (
        coalesce(
          nullif(j.pi_unit_cost_base, 0),
          case
            when j.pi_uom_id is not null then public.item_unit_cost_to_base(j.item_id, coalesce(j.pi_unit_cost, 0), j.pi_uom_id)
            else null
          end,
          coalesce(j.pi_unit_cost, 0),
          0
        )
        + coalesce(j.mi_transport_cost, 0)
        + coalesce(j.mi_supply_tax_cost, 0)
        + coalesce(j.pri_transport_cost, 0)
        + coalesce(j.pri_supply_tax_cost, 0)
      )::numeric as expected_unit_cost
    from joined j
  )
  select
    c.movement_id,
    c.occurred_at,
    c.item_id,
    c.reference_table,
    c.reference_id,
    c.quantity,
    c.unit_cost,
    c.total_cost,
    c.expected_unit_cost,
    (c.expected_qty_base * c.expected_unit_cost)::numeric as expected_total_cost,
    case
      when (c.expected_qty_base * c.expected_unit_cost) > 0 then (c.total_cost / (c.expected_qty_base * c.expected_unit_cost))::numeric
      else null
    end as inflation_factor
  from calc c
  where (c.expected_qty_base * c.expected_unit_cost) > 0
    and abs(coalesce(c.total_cost, 0) - (c.expected_qty_base * c.expected_unit_cost)) > 0.01
    and (coalesce(c.total_cost, 0) / (c.expected_qty_base * c.expected_unit_cost)) > 1.05
    and (coalesce(c.total_cost, 0) / (c.expected_qty_base * c.expected_unit_cost)) < 500
    and not exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'ledger_repairs'
        and je.source_id = c.fix_source_uuid::text
        and je.source_event = 'fix_purchase_in_uom'
    )
  order by c.occurred_at desc, c.movement_id desc;
end;
$$;

revoke all on function public.detect_purchase_in_uom_inflation(timestamptz, timestamptz, int) from public;
revoke execute on function public.detect_purchase_in_uom_inflation(timestamptz, timestamptz, int) from anon;
grant execute on function public.detect_purchase_in_uom_inflation(timestamptz, timestamptz, int) to authenticated, service_role;

create or replace function public.repair_purchase_in_uom_inflation(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_limit int default 200,
  p_dry_run boolean default true
)
returns table(
  movement_id uuid,
  occurred_at timestamptz,
  item_id text,
  posted_total_cost numeric,
  expected_total_cost numeric,
  delta numeric,
  journal_entry_id uuid,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_fix_source_uuid uuid;
  v_entry_id uuid;
  v_inventory uuid;
  v_ap uuid;
  v_wh uuid;
  v_branch uuid;
  v_company uuid;
  v_delta numeric;
  v_mv record;
begin
  perform public._require_staff('repair_purchase_in_uom_inflation');
  p_limit := greatest(1, least(coalesce(p_limit, 200), 2000));

  v_inventory := public.get_account_id_by_code('1410');
  v_ap := public.get_account_id_by_code('2010');
  if v_inventory is null or v_ap is null then
    raise exception 'required accounts not found (inventory 1410 / AP 2010)';
  end if;

  for r in
    select *
    from public.detect_purchase_in_uom_inflation(p_start, p_end, p_limit)
  loop
    v_fix_source_uuid := public.uuid_from_text(concat('uomfix:purchase_in:', r.movement_id::text));
    v_delta := public._money_round(coalesce(r.total_cost, 0) - coalesce(r.expected_total_cost, 0));

    if abs(coalesce(v_delta, 0)) <= 0.01 then
      continue;
    end if;

    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'ledger_repairs'
        and je.source_id = v_fix_source_uuid::text
        and je.source_event = 'fix_purchase_in_uom'
    ) then
      return query
      select r.movement_id, r.occurred_at, r.item_id, r.total_cost, r.expected_total_cost, v_delta, null::uuid, 'skipped_already_fixed';
      continue;
    end if;

    if p_dry_run then
      return query
      select r.movement_id, r.occurred_at, r.item_id, r.total_cost, r.expected_total_cost, v_delta, null::uuid, 'dry_run';
      continue;
    end if;

    select im.* into v_mv
    from public.inventory_movements im
    where im.id = r.movement_id;

    v_wh := null;
    if v_mv.warehouse_id is not null then
      v_wh := v_mv.warehouse_id;
    else
      begin
        if (v_mv.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_wh := (v_mv.data->>'warehouseId')::uuid;
        end if;
      exception when others then
        v_wh := null;
      end;
    end if;

    v_branch := coalesce(public.branch_from_warehouse(v_wh), public.get_default_branch_id());
    v_company := coalesce(public.company_from_branch(v_branch), public.get_default_company_id());

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, branch_id, company_id)
    values (
      r.occurred_at,
      concat('Fix purchase_in UOM inflation ', r.item_id, ' movement ', r.movement_id::text),
      'ledger_repairs',
      v_fix_source_uuid::text,
      'fix_purchase_in_uom',
      auth.uid(),
      'posted',
      v_branch,
      v_company
    )
    returning id into v_entry_id;

    if v_delta > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_delta, 0, 'Reduce supplier payable (UOM fix)'),
        (v_entry_id, v_inventory, 0, v_delta, 'Reduce inventory (UOM fix)');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, -v_delta, 0, 'Increase inventory (UOM fix)'),
        (v_entry_id, v_ap, 0, -v_delta, 'Increase supplier payable (UOM fix)');
    end if;

    perform public.check_journal_entry_balance(v_entry_id);

    return query
    select r.movement_id, r.occurred_at, r.item_id, r.total_cost, r.expected_total_cost, v_delta, v_entry_id, 'fixed';
  end loop;
end;
$$;

revoke all on function public.repair_purchase_in_uom_inflation(timestamptz, timestamptz, int, boolean) from public;
revoke execute on function public.repair_purchase_in_uom_inflation(timestamptz, timestamptz, int, boolean) from anon;
grant execute on function public.repair_purchase_in_uom_inflation(timestamptz, timestamptz, int, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
