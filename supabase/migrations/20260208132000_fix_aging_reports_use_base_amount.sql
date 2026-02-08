set app.allow_ledger_ddl = '1';

create or replace function public.ar_aging_summary(p_as_of date default current_date)
returns table(
  customer_auth_user_id uuid,
  current numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_91_plus numeric,
  total_outstanding numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with items as (
    select
      o.customer_auth_user_id,
      coalesce(a.open_balance, 0) as outstanding_base,
      greatest(0, (p_as_of - je.entry_date::date))::int as age_days
    from public.ar_open_items a
    join public.orders o on o.id = a.invoice_id
    join public.journal_entries je on je.id = a.journal_entry_id
    where public.can_view_accounting_reports()
      and a.status = 'open'
      and je.entry_date::date <= p_as_of
      and coalesce(a.open_balance, 0) > 1e-9
  )
  select
    i.customer_auth_user_id,
    coalesce(sum(case when i.age_days <= 0 then i.outstanding_base else 0 end), 0) as current,
    coalesce(sum(case when i.age_days between 1 and 30 then i.outstanding_base else 0 end), 0) as days_1_30,
    coalesce(sum(case when i.age_days between 31 and 60 then i.outstanding_base else 0 end), 0) as days_31_60,
    coalesce(sum(case when i.age_days between 61 and 90 then i.outstanding_base else 0 end), 0) as days_61_90,
    coalesce(sum(case when i.age_days >= 91 then i.outstanding_base else 0 end), 0) as days_91_plus,
    coalesce(sum(i.outstanding_base), 0) as total_outstanding
  from items i
  group by i.customer_auth_user_id
  order by total_outstanding desc;
$$;

revoke all on function public.ar_aging_summary(date) from public;
revoke execute on function public.ar_aging_summary(date) from anon;
grant execute on function public.ar_aging_summary(date) to authenticated;

create or replace function public.ap_aging_summary(p_as_of date default current_date)
returns table(
  supplier_id uuid,
  current numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_91_plus numeric,
  total_outstanding numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := public.get_base_currency();
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with po as (
    select
      po.id as purchase_order_id,
      po.supplier_id,
      po.purchase_date as invoice_date,
      upper(coalesce(po.currency, v_base)) as currency,
      coalesce(
        po.base_total,
        case when upper(coalesce(po.currency, v_base)) = upper(v_base) then po.total_amount else null end,
        0
      ) as total_base
    from public.purchase_orders po
    where po.status <> 'cancelled'
      and po.purchase_date <= p_as_of
  ),
  paid as (
    select
      p.reference_id::uuid as purchase_order_id,
      coalesce(sum(
        coalesce(
          p.base_amount,
          case when upper(coalesce(p.currency, v_base)) = upper(v_base) then p.amount else null end,
          0
        )
      ), 0) as paid_base
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.direction = 'out'
      and p.occurred_at::date <= p_as_of
    group by p.reference_id
  ),
  open_items as (
    select
      po.supplier_id,
      greatest(0, po.total_base - coalesce(p.paid_base, 0)) as outstanding_base,
      (p_as_of - po.invoice_date) as age_days
    from po
    left join paid p on p.purchase_order_id = po.purchase_order_id
    where (po.total_base - coalesce(p.paid_base, 0)) > 1e-9
  )
  select
    oi.supplier_id,
    coalesce(sum(case when oi.age_days <= 0 then oi.outstanding_base else 0 end), 0) as current,
    coalesce(sum(case when oi.age_days between 1 and 30 then oi.outstanding_base else 0 end), 0) as days_1_30,
    coalesce(sum(case when oi.age_days between 31 and 60 then oi.outstanding_base else 0 end), 0) as days_31_60,
    coalesce(sum(case when oi.age_days between 61 and 90 then oi.outstanding_base else 0 end), 0) as days_61_90,
    coalesce(sum(case when oi.age_days >= 91 then oi.outstanding_base else 0 end), 0) as days_91_plus,
    coalesce(sum(oi.outstanding_base), 0) as total_outstanding
  from open_items oi
  group by oi.supplier_id
  order by total_outstanding desc;
end;
$$;

revoke all on function public.ap_aging_summary(date) from public;
revoke execute on function public.ap_aging_summary(date) from anon;
grant execute on function public.ap_aging_summary(date) to authenticated;

notify pgrst, 'reload schema';
