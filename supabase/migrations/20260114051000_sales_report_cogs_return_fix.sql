create or replace function public.get_sales_report_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_collected numeric := 0;
  v_total_tax numeric := 0;
  v_total_delivery numeric := 0;
  v_total_discounts numeric := 0;
  v_gross_subtotal numeric := 0;
  v_total_orders integer := 0;
  v_cancelled_orders integer := 0;
  v_delivered_orders integer := 0;
  v_total_returns numeric := 0;
  v_total_cogs numeric := 0;
  v_total_returns_cogs numeric := 0;
  v_total_wastage numeric := 0;
  v_total_expenses numeric := 0;
  v_total_delivery_cost numeric := 0;
  v_out_for_delivery integer := 0;
  v_in_store integer := 0;
  v_online integer := 0;
  v_result json;
begin
  with effective_orders as (
    select
      o.*,
      case when p_invoice_only then o.invoice_issued_at else coalesce(o.invoice_issued_at, o.paid_at, o.delivered_at, o.created_at) end as date_by
    from public.orders o
    where (p_zone_id is null or o.delivery_zone_id = p_zone_id)
  )
  select
    coalesce(sum(eo.total), 0),
    coalesce(sum(eo.tax_amount), 0),
    coalesce(sum(eo.delivery_fee), 0),
    coalesce(sum(eo.discount_amount), 0),
    coalesce(sum(eo.subtotal), 0),
    count(*),
    count(*) filter (where eo.status = 'delivered')
  into
    v_total_collected,
    v_total_tax,
    v_total_delivery,
    v_total_discounts,
    v_gross_subtotal,
    v_total_orders,
    v_delivered_orders
  from effective_orders eo
  where eo.status = 'delivered'
    and eo.paid_at is not null
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.*,
      case when p_invoice_only then o.invoice_issued_at else coalesce(o.invoice_issued_at, o.paid_at, o.delivered_at, o.created_at) end as date_by
    from public.orders o
    where (p_zone_id is null or o.delivery_zone_id = p_zone_id)
  )
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(sr.total_refund_amount), 0)
  into v_total_returns
  from public.sales_returns sr
  join public.orders o on sr.order_id = o.id
  where sr.status = 'completed'
    and sr.return_date >= p_start_date
    and sr.return_date <= p_end_date
    and (p_zone_id is null or o.delivery_zone_id = p_zone_id);

  with effective_orders as (
    select
      o.*,
      case when p_invoice_only then o.invoice_issued_at else coalesce(o.invoice_issued_at, o.paid_at, o.delivered_at, o.created_at) end as date_by
    from public.orders o
    where (p_zone_id is null or o.delivery_zone_id = p_zone_id)
  )
  select coalesce(sum(oic.total_cost), 0)
  into v_total_cogs
  from public.order_item_cogs oic
  join effective_orders eo on oic.order_id = eo.id
  where eo.status = 'delivered'
    and eo.paid_at is not null
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(im.total_cost), 0)
  into v_total_returns_cogs
  from public.inventory_movements im
  where im.reference_table = 'sales_returns'
    and im.movement_type = 'return_in'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id = (im.data->>'orderId')::uuid and o.delivery_zone_id = p_zone_id
      )
    );

  v_total_cogs := greatest(v_total_cogs - v_total_returns_cogs, 0);

  if p_zone_id is null then
    select coalesce(sum(quantity * cost_at_time), 0)
    into v_total_wastage
    from public.stock_wastage
    where created_at >= p_start_date and created_at <= p_end_date;

    select coalesce(sum(amount), 0)
    into v_total_expenses
    from public.expenses
    where date >= p_start_date::date and date <= p_end_date::date;
  else
    v_total_wastage := 0;
    v_total_expenses := 0;
  end if;

  select coalesce(sum(dc.cost_amount), 0)
  into v_total_delivery_cost
  from public.delivery_costs dc
  where dc.occurred_at >= p_start_date
    and dc.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id = dc.order_id and o.delivery_zone_id = p_zone_id
      )
    );

  with effective_orders as (
    select
      o.*,
      case when p_invoice_only then o.invoice_issued_at else coalesce(o.invoice_issued_at, o.paid_at, o.delivered_at, o.created_at) end as date_by
    from public.orders o
    where (p_zone_id is null or o.delivery_zone_id = p_zone_id)
  )
  select
    coalesce(count(*) filter (where status = 'out_for_delivery'), 0),
    coalesce(count(*) filter (where status = 'delivered' and coalesce(order_source, '') = 'in_store'), 0),
    coalesce(count(*) filter (where status = 'delivered' and coalesce(order_source, '') <> 'in_store'), 0)
  into v_out_for_delivery, v_in_store, v_online
  from effective_orders eo
  where eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  v_result := json_build_object(
    'total_collected', v_total_collected,
    'gross_subtotal', v_gross_subtotal,
    'returns', v_total_returns,
    'discounts', v_total_discounts,
    'tax', v_total_tax,
    'delivery_fees', v_total_delivery,
    'delivery_cost', v_total_delivery_cost,
    'cogs', v_total_cogs,
    'wastage', v_total_wastage,
    'expenses', v_total_expenses,
    'total_orders', v_total_orders,
    'delivered_orders', v_delivered_orders,
    'cancelled_orders', v_cancelled_orders,
    'out_for_delivery_count', v_out_for_delivery,
    'in_store_count', v_in_store,
    'online_count', v_online
  );

  return v_result;
end;
$$;
