set app.allow_ledger_ddl = '1';

create or replace function public.party_ledger_statement_v2(
  p_party_id uuid,
  p_account_code text default null,
  p_currency text default null,
  p_start date default null,
  p_end date default null
)
returns table(
  occurred_at timestamptz,
  journal_entry_id uuid,
  journal_line_id uuid,
  account_code text,
  account_name text,
  direction text,
  foreign_amount numeric,
  base_amount numeric,
  currency_code text,
  fx_rate numeric,
  memo text,
  source_table text,
  source_id text,
  source_event text,
  running_balance numeric,
  open_base_amount numeric,
  open_foreign_amount numeric,
  open_status text,
  allocations jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with acct as (
    select coa.id
    from public.chart_of_accounts coa
    where p_account_code is null or coa.code = p_account_code
  ),
  base_ple as (
    select
      ple.occurred_at,
      ple.journal_entry_id,
      ple.journal_line_id,
      coa.code as account_code,
      coa.name as account_name,
      ple.direction,
      ple.foreign_amount,
      ple.base_amount,
      ple.currency_code,
      ple.fx_rate,
      jl.line_memo as memo,
      je.source_table,
      je.source_id,
      je.source_event,
      ple.running_balance
    from public.party_ledger_entries ple
    join public.journal_entries je on je.id = ple.journal_entry_id
    join public.journal_lines jl on jl.id = ple.journal_line_id
    join public.chart_of_accounts coa on coa.id = ple.account_id
    where public.has_admin_permission('accounting.view')
      and ple.party_id = p_party_id
      and (p_currency is null or upper(ple.currency_code) = upper(p_currency))
      and (p_start is null or ple.occurred_at::date >= p_start)
      and (p_end is null or ple.occurred_at::date <= p_end)
      and (p_account_code is null or ple.account_id in (select id from acct))
  ),
  use_fallback as (
    select not exists(select 1 from base_ple) as use_fallback
  ),
  party_links as (
    select fpl.linked_entity_type, fpl.linked_entity_id, fpl.role
    from public.financial_party_links fpl
    where fpl.party_id = p_party_id
  ),
  supplier_ids as (
    select linked_entity_id::uuid as supplier_id
    from party_links
    where role = 'supplier' and linked_entity_type = 'suppliers'
  ),
  customer_ids as (
    select linked_entity_id::uuid as customer_id
    from party_links
    where role = 'customer' and linked_entity_type = 'customers'
  ),
  base_currency as (
    select public.get_base_currency() as code
  ),
  ap_account as (
    select coa.code, coa.name
    from public.chart_of_accounts coa
    where coa.code = '2010'
    limit 1
  ),
  ar_account as (
    select coa.code, coa.name
    from public.chart_of_accounts coa
    where coa.code = '1200'
    limit 1
  ),
  ap_orders as (
    select
      coalesce(po.purchase_date::timestamptz, po.created_at, now()) as occurred_at,
      po.id as journal_entry_id,
      po.id as journal_line_id,
      coalesce(ap_account.code, '2010') as account_code,
      coalesce(ap_account.name, 'Accounts Payable') as account_name,
      'credit' as direction,
      case
        when upper(coalesce(po.currency, base_currency.code)) <> upper(base_currency.code) then coalesce(po.total_amount, 0)
        else null
      end as foreign_amount,
      coalesce(
        po.base_total,
        case when upper(coalesce(po.currency, base_currency.code)) = upper(base_currency.code) then po.total_amount else null end,
        0
      ) as base_amount,
      upper(coalesce(po.currency, base_currency.code)) as currency_code,
      coalesce(po.fx_rate, 1) as fx_rate,
      po.reference_number as memo,
      'purchase_orders' as source_table,
      po.id::text as source_id,
      'purchase' as source_event,
      null::numeric as running_balance
    from public.purchase_orders po
    join supplier_ids s on s.supplier_id = po.supplier_id
    cross join base_currency
    left join ap_account on true
    where (p_currency is null or upper(coalesce(po.currency, base_currency.code)) = upper(p_currency))
      and (p_start is null or coalesce(po.purchase_date::date, po.created_at::date) >= p_start)
      and (p_end is null or coalesce(po.purchase_date::date, po.created_at::date) <= p_end)
  ),
  ap_payments as (
    select
      p.occurred_at as occurred_at,
      p.id as journal_entry_id,
      p.id as journal_line_id,
      coalesce(ap_account.code, '2010') as account_code,
      coalesce(ap_account.name, 'Accounts Payable') as account_name,
      'debit' as direction,
      case
        when upper(coalesce(p.currency, base_currency.code)) <> upper(base_currency.code) then coalesce(p.amount, 0)
        else null
      end as foreign_amount,
      coalesce(
        p.base_amount,
        case when upper(coalesce(p.currency, base_currency.code)) = upper(base_currency.code) then p.amount else null end,
        0
      ) as base_amount,
      upper(coalesce(p.currency, base_currency.code)) as currency_code,
      coalesce(p.fx_rate, 1) as fx_rate,
      null::text as memo,
      'payments' as source_table,
      p.id::text as source_id,
      'payment' as source_event,
      null::numeric as running_balance
    from public.payments p
    join public.purchase_orders po on po.id = p.reference_id::uuid
    join supplier_ids s on s.supplier_id = po.supplier_id
    cross join base_currency
    left join ap_account on true
    where p.reference_table = 'purchase_orders'
      and p.direction = 'out'
      and (p_currency is null or upper(coalesce(p.currency, base_currency.code)) = upper(p_currency))
      and (p_start is null or p.occurred_at::date >= p_start)
      and (p_end is null or p.occurred_at::date <= p_end)
  ),
  ar_orders as (
    select
      coalesce(o.data->>'deliveredAt', o.data->>'paidAt', o.updated_at::text, o.created_at::text)::timestamptz as occurred_at,
      o.id as journal_entry_id,
      o.id as journal_line_id,
      coalesce(ar_account.code, '1200') as account_code,
      coalesce(ar_account.name, 'Accounts Receivable') as account_name,
      'debit' as direction,
      case
        when upper(coalesce(o.currency, base_currency.code)) <> upper(base_currency.code) then coalesce(o.total, 0)
        else null
      end as foreign_amount,
      coalesce(
        o.base_total,
        case when upper(coalesce(o.currency, base_currency.code)) = upper(base_currency.code) then o.total else null end,
        0
      ) as base_amount,
      upper(coalesce(o.currency, base_currency.code)) as currency_code,
      coalesce(o.fx_rate, 1) as fx_rate,
      null::text as memo,
      'orders' as source_table,
      o.id::text as source_id,
      'sale' as source_event,
      null::numeric as running_balance
    from public.orders o
    join customer_ids c on c.customer_id = o.customer_auth_user_id
    cross join base_currency
    left join ar_account on true
    where (p_currency is null or upper(coalesce(o.currency, base_currency.code)) = upper(p_currency))
      and (p_start is null or o.created_at::date >= p_start)
      and (p_end is null or o.created_at::date <= p_end)
  ),
  ar_payments as (
    select
      p.occurred_at as occurred_at,
      p.id as journal_entry_id,
      p.id as journal_line_id,
      coalesce(ar_account.code, '1200') as account_code,
      coalesce(ar_account.name, 'Accounts Receivable') as account_name,
      'credit' as direction,
      case
        when upper(coalesce(p.currency, base_currency.code)) <> upper(base_currency.code) then coalesce(p.amount, 0)
        else null
      end as foreign_amount,
      coalesce(
        p.base_amount,
        case when upper(coalesce(p.currency, base_currency.code)) = upper(base_currency.code) then p.amount else null end,
        0
      ) as base_amount,
      upper(coalesce(p.currency, base_currency.code)) as currency_code,
      coalesce(p.fx_rate, 1) as fx_rate,
      null::text as memo,
      'payments' as source_table,
      p.id::text as source_id,
      'payment' as source_event,
      null::numeric as running_balance
    from public.payments p
    join public.orders o on o.id = p.reference_id::uuid
    join customer_ids c on c.customer_id = o.customer_auth_user_id
    cross join base_currency
    left join ar_account on true
    where p.reference_table = 'orders'
      and p.direction = 'in'
      and (p_currency is null or upper(coalesce(p.currency, base_currency.code)) = upper(p_currency))
      and (p_start is null or p.occurred_at::date >= p_start)
      and (p_end is null or p.occurred_at::date <= p_end)
  ),
  fallback as (
    select * from ap_orders
    union all
    select * from ap_payments
    union all
    select * from ar_orders
    union all
    select * from ar_payments
  ),
  base as (
    select * from base_ple where (select use_fallback from use_fallback) = false
    union all
    select * from fallback where (select use_fallback from use_fallback) = true
  ),
  alloc as (
    select
      poi.journal_line_id,
      jsonb_agg(
        jsonb_build_object(
          'settlementId', sl.settlement_id::text,
          'fromOpenItemId', sl.from_open_item_id::text,
          'toOpenItemId', sl.to_open_item_id::text,
          'allocatedBase', sl.allocated_base_amount,
          'allocatedCounterBase', sl.allocated_counter_base_amount,
          'allocatedForeign', sl.allocated_foreign_amount,
          'realizedFx', sl.realized_fx_amount
        )
        order by sl.created_at asc
      ) as allocations
    from public.party_open_items poi
    join public.settlement_lines sl
      on sl.from_open_item_id = poi.id or sl.to_open_item_id = poi.id
    group by poi.journal_line_id
  )
  select
    b.occurred_at,
    b.journal_entry_id,
    b.journal_line_id,
    b.account_code,
    b.account_name,
    b.direction,
    b.foreign_amount,
    b.base_amount,
    b.currency_code,
    b.fx_rate,
    b.memo,
    b.source_table,
    b.source_id,
    b.source_event,
    case
      when (select use_fallback from use_fallback) = true then
        sum(case when b.direction = 'debit' then coalesce(b.base_amount, 0) else -coalesce(b.base_amount, 0) end)
        over (order by b.occurred_at asc, b.journal_entry_id asc, b.journal_line_id asc)
      else b.running_balance
    end as running_balance,
    poi.open_base_amount,
    poi.open_foreign_amount,
    poi.status as open_status,
    coalesce(a.allocations, '[]'::jsonb) as allocations
  from base b
  left join public.party_open_items poi on poi.journal_line_id = b.journal_line_id
  left join alloc a on a.journal_line_id = b.journal_line_id
  order by b.occurred_at asc, b.journal_entry_id asc, b.journal_line_id asc;
$$;

revoke all on function public.party_ledger_statement_v2(uuid, text, text, date, date) from public;
grant execute on function public.party_ledger_statement_v2(uuid, text, text, date, date) to authenticated;

notify pgrst, 'reload schema';
