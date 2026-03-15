set app.allow_ledger_ddl = '1';

create or replace function public.get_sales_by_currency(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  currency_code text,
  total_foreign_amount numeric,
  total_base_amount numeric,
  order_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := upper(public.get_base_currency());
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      upper(coalesce(
        nullif(btrim(coalesce(o.currency, '')), ''),
        nullif(btrim(coalesce(o.data->>'currency', '')), ''),
        public.get_base_currency()
      )) as currency_code,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total_foreign_raw,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(
            nullif(btrim(coalesce(o.currency, '')), ''),
            nullif(btrim(coalesce(o.data->>'currency', '')), ''),
            public.get_base_currency()
          ),
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
      ) as total_base,
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
    where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
      and (not p_invoice_only or nullif(o.data->'invoiceSnapshot'->>'issuedAt', '') is not null)
  )
  select
    coalesce(eo.currency_code, v_base) as currency_code,
    sum(
      case
        when coalesce(eo.currency_code, v_base) = v_base then coalesce(eo.total_base, 0)
        else coalesce(eo.total_foreign_raw, 0)
      end
    ) as total_foreign_amount,
    sum(coalesce(eo.total_base, 0)) as total_base_amount,
    count(distinct eo.id)::integer as order_count
  from effective_orders eo
  where eo.status <> 'cancelled'
    and (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by coalesce(eo.currency_code, v_base)
  order by total_base_amount desc;
end;
$$;

create or replace function public.get_daily_sales_stats_v2(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false,
  p_warehouse_id uuid default null
)
returns table (
  day_date date,
  total_sales numeric,
  order_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
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
      end as date_by,
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
      ) as total
    from public.orders o
    where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
      and (p_warehouse_id is null or o.warehouse_id = p_warehouse_id)
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
  )
  select
    eo.date_by::date as day_date,
    coalesce(sum(eo.total), 0) as total_sales,
    count(*)::bigint as order_count
  from effective_orders eo
  where eo.status <> 'cancelled'
    and (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$$;

create or replace function public.get_sales_consistency_daily(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false,
  p_warehouse_id uuid default null
)
returns table(
  day_date date,
  summary_base_sales numeric,
  currency_base_sales numeric,
  journal_revenue_base numeric,
  orders_count bigint,
  journal_entries_count bigint,
  delta_summary_vs_currency numeric,
  delta_summary_vs_journal numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := upper(public.get_base_currency());
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      upper(coalesce(
        nullif(btrim(coalesce(o.currency, '')), ''),
        nullif(btrim(coalesce(o.data->>'currency', '')), ''),
        public.get_base_currency()
      )) as currency_code,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total_foreign_raw,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(
            nullif(btrim(coalesce(o.currency, '')), ''),
            nullif(btrim(coalesce(o.data->>'currency', '')), ''),
            public.get_base_currency()
          ),
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
      ) as total_base
    from public.orders o
    where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
      and (p_warehouse_id is null or o.warehouse_id = p_warehouse_id)
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
      and (not p_invoice_only or nullif(o.data->'invoiceSnapshot'->>'issuedAt', '') is not null)
  ),
  eo_filtered as (
    select *
    from effective_orders eo
    where (eo.status = 'delivered' or eo.paid_at is not null)
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  summary_by_day as (
    select eo.date_by::date as day_date, sum(coalesce(eo.total_base,0)) as total_base, count(*)::bigint as orders_count
    from eo_filtered eo
    group by eo.date_by::date
  ),
  currency_by_day as (
    select
      eo.date_by::date as day_date,
      sum(coalesce(eo.total_base,0)) as total_base
    from eo_filtered eo
    group by eo.date_by::date, eo.currency_code
  ),
  currency_by_day_agg as (
    select day_date, sum(total_base) as total_base
    from currency_by_day
    group by day_date
  ),
  journal_by_day as (
    select
      je.entry_date::date as day_date,
      sum(coalesce(jl.credit,0)) as total_base,
      count(distinct je.id)::bigint as entry_count
    from eo_filtered eo
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = eo.id::text
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
     and jl.credit > 0
    join public.chart_of_accounts coa
      on coa.id = jl.account_id
     and (coa.code like '4%' or coa.code = '2210')
    where je.entry_date >= p_start_date::date
      and je.entry_date <= p_end_date::date
    group by je.entry_date::date
  ),
  days as (
    select day_date from summary_by_day
    union
    select day_date from currency_by_day_agg
    union
    select day_date from journal_by_day
  )
  select
    d.day_date,
    coalesce(s.total_base, 0) as summary_base_sales,
    coalesce(c.total_base, 0) as currency_base_sales,
    coalesce(j.total_base, 0) as journal_revenue_base,
    coalesce(s.orders_count, 0)::bigint as orders_count,
    coalesce(j.entry_count, 0)::bigint as journal_entries_count,
    coalesce(s.total_base, 0) - coalesce(c.total_base, 0) as delta_summary_vs_currency,
    coalesce(s.total_base, 0) - coalesce(j.total_base, 0) as delta_summary_vs_journal
  from days d
  left join summary_by_day s on s.day_date = d.day_date
  left join currency_by_day_agg c on c.day_date = d.day_date
  left join journal_by_day j on j.day_date = d.day_date
  order by d.day_date;
end;
$$;

revoke all on function public.get_sales_by_currency(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_sales_by_currency(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_sales_by_currency(timestamptz, timestamptz, uuid, boolean) to authenticated;

revoke all on function public.get_daily_sales_stats_v2(timestamptz, timestamptz, uuid, boolean, uuid) from public;
revoke execute on function public.get_daily_sales_stats_v2(timestamptz, timestamptz, uuid, boolean, uuid) from anon;
grant execute on function public.get_daily_sales_stats_v2(timestamptz, timestamptz, uuid, boolean, uuid) to authenticated;

revoke all on function public.get_sales_consistency_daily(timestamptz, timestamptz, uuid, boolean, uuid) from public;
revoke execute on function public.get_sales_consistency_daily(timestamptz, timestamptz, uuid, boolean, uuid) from anon;
grant execute on function public.get_sales_consistency_daily(timestamptz, timestamptz, uuid, boolean, uuid) to authenticated;

notify pgrst, 'reload schema';
