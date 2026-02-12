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
      case when im.reference_table = 'purchase_receipts' and im.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then im.reference_id::uuid else null end as ref_receipt_uuid,
      case when im.reference_table = 'purchase_orders' and im.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then im.reference_id::uuid else null end as ref_po_uuid,
      case when (im.data->>'purchaseOrderId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (im.data->>'purchaseOrderId')::uuid else null end as data_po_uuid,
      case when (im.data->>'purchaseReceiptId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (im.data->>'purchaseReceiptId')::uuid else null end as data_receipt_uuid,
      public.uuid_from_text(concat('uomfix:purchase_in:', im.id::text)) as fix_source_uuid
    from public.inventory_movements im
    where im.movement_type = 'purchase_in'
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
      mv.qty_base as mv_qty_base,
      mv.uom_id as mv_uom_id,
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
      pri.qty_base as pri_qty_base,
      pri.quantity as pri_qty,
      pri.unit_cost as pri_unit_cost,
      pri.uom_id as pri_uom_id,
      pri.transport_cost as pri_transport_cost,
      pri.supply_tax_cost as pri_supply_tax_cost
    from mv
    left join public.purchase_receipts pr
      on pr.id = coalesce(mv.ref_receipt_uuid, mv.data_receipt_uuid)
    left join public.purchase_items pi
      on pi.purchase_order_id = coalesce(mv.ref_po_uuid, mv.data_po_uuid, pr.purchase_order_id)
      and pi.item_id = mv.item_id
    left join public.menu_items mi on mi.id = mv.item_id
    left join public.purchase_receipt_items pri
      on pri.receipt_id = coalesce(mv.ref_receipt_uuid, mv.data_receipt_uuid, pr.id)
      and pri.item_id = mv.item_id
  ),
  uoms as (
    select
      j.*,
      iu.base_uom_id,
      iuu_pi.qty_in_base as pi_qty_in_base,
      iuu_pri.qty_in_base as pri_qty_in_base
    from joined j
    left join public.item_uom iu on iu.item_id = j.item_id
    left join public.item_uom_units iuu_pi
      on iuu_pi.item_id = j.item_id
      and iuu_pi.uom_id = j.pi_uom_id
      and iuu_pi.is_active = true
    left join public.item_uom_units iuu_pri
      on iuu_pri.item_id = j.item_id
      and iuu_pri.uom_id = j.pri_uom_id
      and iuu_pri.is_active = true
  ),
  calc as (
    select
      u.*,
      greatest(
        coalesce(u.mv_qty_base, u.pri_qty_base, u.pi_qty_base, u.quantity, u.pri_qty, u.pi_qty, 0),
        0
      )::numeric as expected_qty_base,
      (
        coalesce(
          case
            when u.pri_unit_cost is not null then
              case
                when u.pri_qty_base is not null and u.pri_qty is not null and u.pri_qty_base > 0 and u.pri_qty > 0 then (u.pri_unit_cost * u.pri_qty / u.pri_qty_base)
                when u.base_uom_id is null or u.pri_uom_id is null or u.pri_uom_id = u.base_uom_id then u.pri_unit_cost
                when u.pri_qty_in_base is not null and u.pri_qty_in_base > 0 then u.pri_unit_cost / u.pri_qty_in_base
                else null
              end
            else null
          end,
          case
            when u.pi_unit_cost is not null then
              case
                when u.pi_qty_base is not null and u.pi_qty is not null and u.pi_qty_base > 0 and u.pi_qty > 0 then (u.pi_unit_cost * u.pi_qty / u.pi_qty_base)
                when u.base_uom_id is null or u.pi_uom_id is null or u.pi_uom_id = u.base_uom_id then u.pi_unit_cost
                when u.pi_qty_in_base is not null and u.pi_qty_in_base > 0 then u.pi_unit_cost / u.pi_qty_in_base
                else null
              end
            else null
          end,
          nullif(u.pi_unit_cost_base, 0),
          coalesce(u.unit_cost, 0),
          0
        )
        + coalesce(u.mi_transport_cost, 0)
        + coalesce(u.mi_supply_tax_cost, 0)
        + coalesce(u.pri_transport_cost, 0)
        + coalesce(u.pri_supply_tax_cost, 0)
      )::numeric as expected_unit_cost
    from uoms u
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

notify pgrst, 'reload schema';
