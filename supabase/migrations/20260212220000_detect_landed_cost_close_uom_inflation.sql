set app.allow_ledger_ddl = '1';

create or replace function public.detect_landed_cost_close_uom_inflation(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_limit int default 200
)
returns table(
  entry_id uuid,
  entry_date timestamptz,
  shipment_id text,
  source_event text,
  inventory_amount numeric,
  cogs_amount numeric,
  expenses_total numeric,
  expected_total numeric,
  inflation_factor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_accounts jsonb;
  v_inventory uuid;
  v_cogs uuid;
begin
  perform public._require_staff('detect_landed_cost_close_uom_inflation');
  p_limit := greatest(1, least(coalesce(p_limit, 200), 2000));

  select s.data->'settings'->'accounting_accounts'
  into v_accounts
  from public.app_settings s
  where s.id = 'app';

  if v_accounts is null then
    select s.data->'accounting_accounts'
    into v_accounts
    from public.app_settings s
    where s.id = 'singleton';
  end if;

  v_inventory := null;
  if v_accounts is not null and nullif(v_accounts->>'inventory', '') is not null then
    begin
      v_inventory := (v_accounts->>'inventory')::uuid;
    exception when others then
      v_inventory := public.get_account_id_by_code(v_accounts->>'inventory');
    end;
  end if;
  v_inventory := coalesce(v_inventory, public.get_account_id_by_code('1410'));

  v_cogs := null;
  if v_accounts is not null and nullif(v_accounts->>'cogs', '') is not null then
    begin
      v_cogs := (v_accounts->>'cogs')::uuid;
    exception when others then
      v_cogs := public.get_account_id_by_code(v_accounts->>'cogs');
    end;
  end if;
  v_cogs := coalesce(v_cogs, public.get_account_id_by_code('5010'));

  return query
  with base as (
    select
      je.id as entry_id,
      je.entry_date,
      je.source_id as shipment_source_id,
      je.source_event,
      public.uuid_from_text(concat('uomfix:landed_cost:', je.id::text)) as fix_source_uuid
    from public.journal_entries je
    where je.source_table = 'import_shipments'
      and je.source_event in ('landed_cost_close', 'landed_cost_cogs_adjust')
      and (p_start is null or je.entry_date >= p_start)
      and (p_end is null or je.entry_date <= p_end)
    order by je.entry_date desc, je.id desc
    limit p_limit
  ),
  sums as (
    select
      b.entry_id,
      b.entry_date,
      b.shipment_source_id,
      b.source_event,
      sum(case when jl.account_id = v_inventory then coalesce(jl.debit, 0) - coalesce(jl.credit, 0) else 0 end)::numeric as inventory_amount,
      sum(case when jl.account_id = v_cogs then coalesce(jl.debit, 0) - coalesce(jl.credit, 0) else 0 end)::numeric as cogs_amount
    from base b
    join public.journal_lines jl on jl.journal_entry_id = b.entry_id
    group by b.entry_id, b.entry_date, b.shipment_source_id, b.source_event
  ),
  exp as (
    select
      s.entry_id,
      coalesce(sum(coalesce(ie.base_amount, coalesce(ie.amount, 0) * coalesce(ie.exchange_rate, 1))), 0)::numeric as expenses_total
    from sums s
    left join public.import_expenses ie on ie.shipment_id::text = s.shipment_source_id
    group by s.entry_id
  ),
  joined as (
    select
      s.entry_id,
      s.entry_date,
      coalesce(nullif(is1.reference_number, ''), s.shipment_source_id) as shipment_id,
      s.source_event,
      s.inventory_amount,
      s.cogs_amount,
      e.expenses_total,
      e.expenses_total as expected_total
    from sums s
    join exp e on e.entry_id = s.entry_id
    left join public.import_shipments is1 on is1.id::text = s.shipment_source_id
  )
  select
    j.entry_id,
    j.entry_date,
    j.shipment_id,
    j.source_event,
    j.inventory_amount,
    j.cogs_amount,
    j.expenses_total,
    j.expected_total,
    case when j.expected_total > 0 then ((j.inventory_amount + j.cogs_amount) / j.expected_total)::numeric else null end as inflation_factor
  from joined j
  where j.expected_total > 0
    and abs((j.inventory_amount + j.cogs_amount) - j.expected_total) > 0.01
    and ((j.inventory_amount + j.cogs_amount) / j.expected_total) > 1.05
    and ((j.inventory_amount + j.cogs_amount) / j.expected_total) < 500
  order by j.entry_date desc, j.entry_id desc;
end;
$$;

revoke all on function public.detect_landed_cost_close_uom_inflation(timestamptz, timestamptz, int) from public;
revoke execute on function public.detect_landed_cost_close_uom_inflation(timestamptz, timestamptz, int) from anon;
grant execute on function public.detect_landed_cost_close_uom_inflation(timestamptz, timestamptz, int) to authenticated;

notify pgrst, 'reload schema';
