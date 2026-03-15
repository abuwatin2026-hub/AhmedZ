-- Fix get_sales_report_summary: use EXECUTE for expenses section  
-- to avoid "column e.status does not exist" when table has no status column
-- The expenses table has: id, title, amount, category, date, notes, created_at, created_by, 
-- cost_center_id, data, currency, fx_rate, base_amount, fx_locked
-- It does NOT have: status, zone_id

do $fix$
declare
  v_body text;
begin
  -- Get the current function body
  select prosrc into v_body
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_report_summary'
  limit 1;

  -- Replace the expenses section with a version that checks column existence
  -- Old pattern: e.status = 'approved' ... and (p_zone_id is null or e.zone_id = p_zone_id)
  -- New pattern: no status check, no zone_id check, just sum by amount
end $fix$;

-- Simply re-deploy with the corrected expenses section
-- Use dynamic SQL (EXECUTE) to check for columns that may or may not exist

create or replace function public.get_sales_report_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_total_collected numeric := 0;
  v_total_sales_accrual numeric := 0;
  v_total_tax numeric := 0;
  v_total_delivery numeric := 0;
  v_total_discounts numeric := 0;
  v_gross_subtotal numeric := 0;
  v_total_orders integer := 0;
  v_total_orders_accrual integer := 0;
  v_cancelled_orders integer := 0;
  v_delivered_orders integer := 0;
  v_total_returns numeric := 0;
  v_total_returns_total numeric := 0;
  v_total_cogs numeric := 0;
  v_total_returns_cogs numeric := 0;
  v_total_wastage numeric := 0;
  v_total_expenses numeric := 0;
  v_total_delivery_cost numeric := 0;
  v_out_for_delivery integer := 0;
  v_in_store integer := 0;
  v_online integer := 0;
  v_tax_refunds numeric := 0;
  v_result jsonb;
  v_has_status boolean := false;
  v_has_zone boolean := false;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ) as fx_rate_effective,
      coalesce(
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      (coalesce(nullif((o.data->>'taxAmount')::numeric, null), coalesce(o.tax_amount, 0), 0) * coalesce(public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ), 1)) as tax_amount,
      (coalesce(nullif((o.data->>'deliveryFee')::numeric, null), 0) * coalesce(public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ), 1)) as delivery_fee,
      (coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) * coalesce(public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ), 1)) as discount_amount,
      (coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) * coalesce(public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ), 1)) as subtotal,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    coalesce(sum(eo.total) filter (where eo.paid_at is not null or (eo.status = 'delivered' and eo.payment_method <> 'cash')), 0),
    coalesce(sum(eo.total) filter (where eo.status = 'delivered' or eo.paid_at is not null), 0),
    coalesce(sum(eo.tax_amount) filter (where eo.status = 'delivered' or eo.paid_at is not null), 0),
    coalesce(sum(eo.delivery_fee) filter (where eo.status = 'delivered' or eo.paid_at is not null), 0),
    coalesce(sum(eo.discount_amount) filter (where eo.status = 'delivered' or eo.paid_at is not null), 0),
    coalesce(sum(eo.subtotal) filter (where eo.status = 'delivered' or eo.paid_at is not null), 0),
    count(*) filter (where eo.paid_at is not null or (eo.status = 'delivered' and eo.payment_method <> 'cash')),
    count(*) filter (where eo.status = 'delivered' or eo.paid_at is not null),
    count(*) filter (where eo.status = 'delivered')
  into
    v_total_collected,
    v_total_sales_accrual,
    v_total_tax,
    v_total_delivery,
    v_total_discounts,
    v_gross_subtotal,
    v_total_orders,
    v_total_orders_accrual,
    v_delivered_orders
  from effective_orders eo
  where (
      eo.status <> 'cancelled'
      and (
      eo.status = 'delivered'
      or eo.paid_at is not null
      )
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.status,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with returns_calc as (
    select
      sr.id as return_id,
      sr.return_date,
      o.id as order_id,
      coalesce(sr.total_refund_amount, 0) as return_subtotal,
      upper(coalesce(
        nullif(btrim(coalesce(o.currency, '')), ''),
        nullif(btrim(coalesce(o.data->>'currency', '')), ''),
        public.get_base_currency()
      )) as currency_code,
      public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        sr.return_date,
        o.fx_rate
      ) as fx_rate,
      greatest(coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) - coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0), 0) as order_net_subtotal,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), coalesce(o.tax_amount, 0), 0) as order_tax
    from public.sales_returns sr
    join public.orders o on o.id::text = sr.order_id::text
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
  ),
  returns_base as (
    select
      coalesce(sum(rc.return_subtotal), 0) as return_subtotal,
      coalesce(sum(
        case
          when rc.order_net_subtotal > 0 and rc.order_tax > 0 and rc.return_subtotal > 0
            then least(rc.order_tax, (rc.return_subtotal / rc.order_net_subtotal) * rc.order_tax)
          else 0
        end
      ), 0) as tax_refund,
      max(rc.fx_rate) as fx_rate
    from returns_calc rc
    group by rc.return_id
  )
  select
    coalesce(sum(rb.return_subtotal * rb.fx_rate), 0),
    coalesce(sum(rb.tax_refund * rb.fx_rate), 0),
    coalesce(sum((rb.return_subtotal + rb.tax_refund) * rb.fx_rate), 0)
  into v_total_returns, v_tax_refunds, v_total_returns_total
  from returns_base rb;

  v_total_tax := greatest(v_total_tax - v_tax_refunds, 0);

  with effective_orders as (
    select
      o.id,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select coalesce(sum(oic.total_cost), 0)
  into v_total_cogs
  from public.order_item_cogs oic
  join effective_orders eo on oic.order_id = eo.id
  where eo.status <> 'cancelled'
    and (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(im.total_cost), 0)
  into v_total_returns_cogs
  from public.inventory_movements im
  join public.sales_returns sr
    on sr.id::text = im.reference_id
   and sr.status = 'completed'
  where im.reference_table = 'sales_returns'
    and im.movement_type = 'return_in'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id = sr.order_id
          and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
          and coalesce(
            o.delivery_zone_id,
            case
              when nullif(o.data->>'deliveryZoneId','') is not null
                   and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (o.data->>'deliveryZoneId')::uuid
              else null
            end
          ) = p_zone_id
      )
    );

  v_total_cogs := greatest(v_total_cogs - v_total_returns_cogs, 0);

  if to_regclass('public.wastage_records') is not null then
    begin
      select coalesce(sum(w.cost_amount), 0)
      into v_total_wastage
      from public.wastage_records w
      where w.status = 'approved'
        and w.created_at >= p_start_date
        and w.created_at <= p_end_date
        and (p_zone_id is null or w.zone_id = p_zone_id);
    exception when others then
      v_total_wastage := 0;
    end;
  elsif to_regclass('public.stock_wastage') is not null then
    begin
      select coalesce(sum(sw.quantity * sw.cost_at_time), 0)
      into v_total_wastage
      from public.stock_wastage sw
      where sw.created_at >= p_start_date
        and sw.created_at <= p_end_date;
    exception when others then
      v_total_wastage := 0;
    end;
  else
    v_total_wastage := 0;
  end if;

  -- EXPENSES: use EXECUTE (dynamic SQL) to handle missing columns gracefully
  if to_regclass('public.expenses') is not null then
    -- Check if status column exists
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'status'
    ) into v_has_status;
    
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'zone_id'
    ) into v_has_zone;
    
    begin
      if v_has_status and v_has_zone then
        execute format(
          'select coalesce(sum(amount), 0) from public.expenses where status = $1 and created_at >= $2 and created_at <= $3 and ($4::uuid is null or zone_id = $4)',
          'approved'
        ) into v_total_expenses using 'approved', p_start_date, p_end_date, p_zone_id;
      elsif v_has_status then
        execute 'select coalesce(sum(amount), 0) from public.expenses where status = $1 and created_at >= $2 and created_at <= $3'
        into v_total_expenses using 'approved', p_start_date, p_end_date;
      else
        select coalesce(sum(amount), 0)
        into v_total_expenses
        from public.expenses
        where created_at >= p_start_date
          and created_at <= p_end_date;
      end if;
    exception when others then
      v_total_expenses := 0;
    end;
  else
    v_total_expenses := 0;
  end if;

  if to_regclass('public.delivery_costs') is not null then
    begin
      select coalesce(sum(dc.cost_amount), 0)
      into v_total_delivery_cost
      from public.delivery_costs dc
      where dc.created_at >= p_start_date
        and dc.created_at <= p_end_date
        and (p_zone_id is null or dc.zone_id = p_zone_id);
    exception when others then
      v_total_delivery_cost := 0;
    end;
  else
    v_total_delivery_cost := 0;
  end if;

  with effective_orders as (
    select
      o.status,
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    coalesce(count(*) filter (where eo.status = 'out_for_delivery'), 0),
    coalesce(count(*) filter (where eo.status = 'delivered' and coalesce(eo.order_source,'') = 'in_store'), 0),
    coalesce(count(*) filter (where eo.status = 'delivered' and coalesce(eo.order_source,'') <> 'in_store'), 0)
  into v_out_for_delivery, v_in_store, v_online
  from effective_orders eo
  where eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  v_result := jsonb_build_object(
    'total_collected', public._money_round(v_total_collected),
    'total_sales_accrual', public._money_round(v_total_sales_accrual),
    'gross_subtotal', public._money_round(v_gross_subtotal),
    'returns', public._money_round(v_total_returns),
    'returns_total', public._money_round(v_total_returns_total),
    'tax_refunds', public._money_round(v_tax_refunds),
    'discounts', public._money_round(v_total_discounts),
    'tax', public._money_round(v_total_tax),
    'delivery_fees', public._money_round(v_total_delivery),
    'delivery_cost', public._money_round(v_total_delivery_cost),
    'cogs', public._money_round(v_total_cogs),
    'returns_cogs', public._money_round(v_total_returns_cogs),
    'wastage', public._money_round(v_total_wastage),
    'expenses', public._money_round(v_total_expenses),
    'total_orders', v_total_orders,
    'total_orders_accrual', v_total_orders_accrual,
    'delivered_orders', v_delivered_orders,
    'cancelled_orders', v_cancelled_orders,
    'out_for_delivery_count', v_out_for_delivery,
    'in_store_count', v_in_store,
    'online_count', v_online
  );

  return v_result;
end;
$fn$;

revoke all on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) from public;
grant execute on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
