set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.party_ledger_entries') is null then
    create table public.party_ledger_entries (
      id uuid primary key default gen_random_uuid(),
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
      journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
      journal_line_id uuid not null references public.journal_lines(id) on delete restrict,
      occurred_at timestamptz not null,
      direction text not null check (direction in ('debit','credit')),
      foreign_amount numeric,
      base_amount numeric not null,
      currency_code text not null,
      fx_rate numeric,
      running_balance numeric not null,
      created_at timestamptz not null default now()
    );
    create unique index if not exists uq_party_ledger_entries_line on public.party_ledger_entries(journal_line_id);
    create index if not exists idx_party_ledger_entries_party on public.party_ledger_entries(party_id, occurred_at desc);
    create index if not exists idx_party_ledger_entries_party_currency on public.party_ledger_entries(party_id, currency_code, occurred_at desc);
    create index if not exists idx_party_ledger_entries_entry on public.party_ledger_entries(journal_entry_id);
    create index if not exists idx_party_ledger_entries_currency on public.party_ledger_entries(currency_code);
  end if;
end $$;

alter table public.party_ledger_entries enable row level security;

drop policy if exists party_ledger_entries_select on public.party_ledger_entries;
create policy party_ledger_entries_select
on public.party_ledger_entries
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists party_ledger_entries_insert on public.party_ledger_entries;
create policy party_ledger_entries_insert
on public.party_ledger_entries
for insert
with check (public.has_admin_permission('accounting.manage') or auth.role() = 'service_role');

drop policy if exists party_ledger_entries_update_none on public.party_ledger_entries;
create policy party_ledger_entries_update_none
on public.party_ledger_entries
for update
using (false);

drop policy if exists party_ledger_entries_delete_none on public.party_ledger_entries;
create policy party_ledger_entries_delete_none
on public.party_ledger_entries
for delete
using (false);

create or replace function public.trg_party_ledger_entries_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'party ledger is append-only';
end;
$$;

drop trigger if exists trg_party_ledger_entries_append_only on public.party_ledger_entries;
create trigger trg_party_ledger_entries_append_only
before update or delete on public.party_ledger_entries
for each row execute function public.trg_party_ledger_entries_append_only();

create or replace function public._party_ledger_delta(p_account_id uuid, p_direction text, p_amount numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_amt numeric;
begin
  if p_account_id is null then
    return 0;
  end if;
  v_amt := coalesce(p_amount, 0);
  if v_amt = 0 then
    return 0;
  end if;
  select coa.normal_balance into v_norm from public.chart_of_accounts coa where coa.id = p_account_id;
  v_norm := coalesce(v_norm, 'debit');
  if v_norm = 'debit' then
    return case when p_direction = 'debit' then v_amt else -v_amt end;
  end if;
  return case when p_direction = 'credit' then v_amt else -v_amt end;
end;
$$;

create or replace function public.insert_party_ledger_for_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_line record;
  v_party_id uuid;
  v_is_party_account boolean := false;
  v_dir text;
  v_amt numeric;
  v_curr text;
  v_prev numeric;
  v_delta numeric;
  v_lock_key bigint;
begin
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select je.id, je.entry_date, je.source_table, je.source_id, je.status
  into v_entry
  from public.journal_entries je
  where je.id = p_entry_id;

  if v_entry.id is null then
    raise exception 'journal entry not found';
  end if;

  if coalesce(v_entry.status, 'posted') <> 'posted' then
    return;
  end if;

  for v_line in
    select jl.id, jl.account_id, jl.debit, jl.credit, jl.party_id, jl.currency_code, jl.fx_rate, jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = p_entry_id
  loop
    select exists(
      select 1 from public.party_subledger_accounts psa
      where psa.account_id = v_line.account_id and psa.is_active = true
      limit 1
    ) into v_is_party_account;
    if v_is_party_account is not true then
      continue;
    end if;

    v_party_id := v_line.party_id;
    if v_party_id is null then
      v_party_id := public._resolve_party_for_entry(coalesce(v_entry.source_table,''), coalesce(v_entry.source_id,''));
    end if;
    if v_party_id is null then
      continue;
    end if;

    v_dir := case when coalesce(v_line.debit, 0) > 0 then 'debit' else 'credit' end;
    v_amt := greatest(coalesce(v_line.debit, 0), coalesce(v_line.credit, 0));
    if v_amt <= 0 then
      continue;
    end if;

    v_curr := upper(nullif(btrim(coalesce(v_line.currency_code, '')), ''));
    if v_curr is null then
      v_curr := public.get_base_currency();
    end if;

    v_lock_key := hashtextextended(v_party_id::text || '|' || v_line.account_id::text || '|' || v_curr, 0);
    perform pg_advisory_xact_lock(v_lock_key);

    select ple.running_balance
    into v_prev
    from public.party_ledger_entries ple
    where ple.party_id = v_party_id
      and ple.account_id = v_line.account_id
      and ple.currency_code = v_curr
    order by ple.occurred_at desc, ple.created_at desc, ple.id desc
    limit 1;

    v_delta := public._party_ledger_delta(v_line.account_id, v_dir, v_amt);

    insert into public.party_ledger_entries(
      party_id, account_id, journal_entry_id, journal_line_id,
      occurred_at, direction, foreign_amount, base_amount, currency_code, fx_rate, running_balance
    )
    values (
      v_party_id,
      v_line.account_id,
      p_entry_id,
      v_line.id,
      v_entry.entry_date,
      v_dir,
      v_line.foreign_amount,
      v_amt,
      v_curr,
      v_line.fx_rate,
      coalesce(v_prev, 0) + coalesce(v_delta, 0)
    )
    on conflict (journal_line_id) do nothing;
  end loop;
end;
$$;

revoke all on function public.insert_party_ledger_for_entry(uuid) from public;
grant execute on function public.insert_party_ledger_for_entry(uuid) to authenticated;

create or replace function public.trg_journal_lines_party_ledger_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_party_ledger_for_entry(new.journal_entry_id);
  return null;
end;
$$;

do $$
begin
  if to_regclass('public.journal_lines') is not null then
    drop trigger if exists trg_journal_lines_party_ledger_after_insert on public.journal_lines;
    create trigger trg_journal_lines_party_ledger_after_insert
    after insert on public.journal_lines
    for each row execute function public.trg_journal_lines_party_ledger_after_insert();
  end if;
end $$;

create or replace function public.trg_journal_entries_party_ledger_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and coalesce(old.status,'') = 'draft'
     and coalesce(new.status,'') = 'posted' then
    perform public.insert_party_ledger_for_entry(new.id);
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.journal_entries') is not null then
    drop trigger if exists trg_journal_entries_party_ledger_on_approve on public.journal_entries;
    create trigger trg_journal_entries_party_ledger_on_approve
    after update of status on public.journal_entries
    for each row execute function public.trg_journal_entries_party_ledger_on_approve();
  end if;
end $$;

create or replace function public.party_ledger_statement(
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
  running_balance numeric
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
  )
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
  order by ple.occurred_at asc, ple.created_at asc, ple.id asc;
$$;

revoke all on function public.party_ledger_statement(uuid, text, text, date, date) from public;
revoke execute on function public.party_ledger_statement(uuid, text, text, date, date) from anon;
grant execute on function public.party_ledger_statement(uuid, text, text, date, date) to authenticated;

create or replace view public.party_ar_aging_summary as
select
  fpl.party_id as party_id,
  a.current,
  a.days_1_30,
  a.days_31_60,
  a.days_61_90,
  a.days_91_plus,
  a.total_outstanding
from public.ar_aging_summary(current_date) a
join public.financial_party_links fpl
  on fpl.role = 'customer'
 and fpl.linked_entity_type = 'customers'
 and fpl.linked_entity_id = a.customer_auth_user_id::text;

alter view public.party_ar_aging_summary set (security_invoker = true);
grant select on public.party_ar_aging_summary to authenticated;

create or replace view public.party_ap_aging_summary as
select
  fpl.party_id as party_id,
  a.current,
  a.days_1_30,
  a.days_31_60,
  a.days_61_90,
  a.days_91_plus,
  a.total_outstanding
from public.ap_aging_summary(current_date) a
join public.financial_party_links fpl
  on fpl.role = 'supplier'
 and fpl.linked_entity_type = 'suppliers'
 and fpl.linked_entity_id = a.supplier_id::text;

alter view public.party_ap_aging_summary set (security_invoker = true);
grant select on public.party_ap_aging_summary to authenticated;

notify pgrst, 'reload schema';
