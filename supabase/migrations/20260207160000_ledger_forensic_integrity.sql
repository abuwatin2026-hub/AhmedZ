set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.ledger_entry_hash_chain') is null then
    create table public.ledger_entry_hash_chain (
      id uuid primary key default gen_random_uuid(),
      journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
      algo text not null default 'sha256',
      prev_chain_hash text,
      content_hash text not null,
      chain_hash text not null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (journal_entry_id)
    );
    create index if not exists idx_ledger_entry_hash_chain_created on public.ledger_entry_hash_chain(created_at desc);
  end if;
end $$;

alter table public.ledger_entry_hash_chain enable row level security;
drop policy if exists ledger_entry_hash_chain_select on public.ledger_entry_hash_chain;
create policy ledger_entry_hash_chain_select on public.ledger_entry_hash_chain
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ledger_entry_hash_chain_insert on public.ledger_entry_hash_chain;
create policy ledger_entry_hash_chain_insert on public.ledger_entry_hash_chain
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ledger_entry_hash_chain_update_none on public.ledger_entry_hash_chain;
create policy ledger_entry_hash_chain_update_none on public.ledger_entry_hash_chain
for update
using (false);
drop policy if exists ledger_entry_hash_chain_delete_none on public.ledger_entry_hash_chain;
create policy ledger_entry_hash_chain_delete_none on public.ledger_entry_hash_chain
for delete
using (false);

create or replace function public._ledger_hash_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'immutable_record';
end;
$$;

do $$
begin
  if to_regclass('public.ledger_entry_hash_chain') is not null then
    drop trigger if exists trg_ledger_entry_hash_chain_immutable on public.ledger_entry_hash_chain;
    create trigger trg_ledger_entry_hash_chain_immutable
    before update or delete on public.ledger_entry_hash_chain
    for each row execute function public._ledger_hash_immutable();
  end if;
end $$;

create or replace function public.compute_journal_entry_content_hash(p_entry_id uuid)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_header text;
  v_lines text;
  v_payload text;
  v_hash text;
begin
  if p_entry_id is null then
    raise exception 'entry_id required';
  end if;

  select concat_ws(
    '|',
    je.id::text,
    je.entry_date::text,
    coalesce(je.memo,''),
    coalesce(je.source_table,''),
    coalesce(je.source_id,''),
    coalesce(je.source_event,''),
    coalesce(je.company_id::text,''),
    coalesce(je.branch_id::text,''),
    coalesce(je.journal_id::text,''),
    coalesce(je.document_id::text,''),
    coalesce(je.currency_code,''),
    coalesce(je.fx_rate::text,''),
    coalesce(je.foreign_amount::text,'')
  )
  into v_header
  from public.journal_entries je
  where je.id = p_entry_id;

  if v_header is null then
    raise exception 'journal entry not found';
  end if;

  select coalesce(string_agg(
    concat_ws(
      '|',
      jl.id::text,
      coa.code,
      coalesce(coa.account_type,''),
      coalesce(coa.normal_balance,''),
      jl.debit::text,
      jl.credit::text,
      coalesce(jl.line_memo,''),
      coalesce(jl.party_id::text,''),
      coalesce(jl.cost_center_id::text,''),
      coalesce(jl.dept_id::text,''),
      coalesce(jl.project_id::text,''),
      coalesce(jl.currency_code,''),
      coalesce(jl.fx_rate::text,''),
      coalesce(jl.foreign_amount::text,'')
    ),
    E'\n'
    order by jl.id
  ), '')
  into v_lines
  from public.journal_lines jl
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where jl.journal_entry_id = p_entry_id;

  v_payload := v_header || E'\n' || v_lines;

  select encode(digest(convert_to(v_payload, 'utf8'), 'sha256'), 'hex') into v_hash;
  return v_hash;
end;
$$;

revoke all on function public.compute_journal_entry_content_hash(uuid) from public;
grant execute on function public.compute_journal_entry_content_hash(uuid) to authenticated;

create or replace function public.trg_append_ledger_hash_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prev_chain text;
  v_content text;
  v_chain text;
begin
  if public._is_migration_actor() then
    return null;
  end if;

  perform public.check_journal_entry_balance(new.id);

  if exists (select 1 from public.ledger_entry_hash_chain x where x.journal_entry_id = new.id) then
    return null;
  end if;

  select lec.chain_hash
  into v_prev_chain
  from public.ledger_entry_hash_chain lec
  join public.journal_entries je2 on je2.id = lec.journal_entry_id
  where (je2.entry_date, je2.created_at, je2.id) < (new.entry_date, new.created_at, new.id)
  order by je2.entry_date desc, je2.created_at desc, je2.id desc
  limit 1;

  v_content := public.compute_journal_entry_content_hash(new.id);
  select encode(digest(convert_to(coalesce(v_prev_chain,'') || '|' || v_content, 'utf8'), 'sha256'), 'hex') into v_chain;

  insert into public.ledger_entry_hash_chain(journal_entry_id, prev_chain_hash, content_hash, chain_hash, created_by)
  values (new.id, v_prev_chain, v_content, v_chain, auth.uid())
  on conflict (journal_entry_id) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_journal_entries_hash_chain on public.journal_entries;
create constraint trigger trg_journal_entries_hash_chain
after insert on public.journal_entries
deferrable initially deferred
for each row execute function public.trg_append_ledger_hash_chain();

create or replace function public.verify_ledger_hash_chain(p_start date default null, p_end date default null, p_max int default 50000)
returns table(
  ok boolean,
  issue text,
  journal_entry_id uuid,
  expected_chain_hash text,
  actual_chain_hash text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_prev text := null;
  v_row record;
  v_expected text;
  v_content text;
  v_seen int := 0;
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  for v_row in
    select
      je.id as journal_entry_id,
      je.entry_date,
      je.created_at,
      lec.prev_chain_hash,
      lec.content_hash,
      lec.chain_hash
    from public.journal_entries je
    join public.ledger_entry_hash_chain lec on lec.journal_entry_id = je.id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
    order by je.entry_date asc, je.created_at asc, je.id asc
    limit greatest(coalesce(p_max, 50000), 1)
  loop
    v_seen := v_seen + 1;
    v_content := public.compute_journal_entry_content_hash(v_row.journal_entry_id);
    if v_content <> v_row.content_hash then
      ok := false;
      issue := 'content_hash_mismatch';
      journal_entry_id := v_row.journal_entry_id;
      expected_chain_hash := null;
      actual_chain_hash := v_row.chain_hash;
      return next;
      continue;
    end if;

    if v_prev is distinct from v_row.prev_chain_hash then
      ok := false;
      issue := 'prev_chain_hash_mismatch';
      journal_entry_id := v_row.journal_entry_id;
      expected_chain_hash := v_prev;
      actual_chain_hash := v_row.prev_chain_hash;
      return next;
      v_prev := v_row.chain_hash;
      continue;
    end if;

    select encode(digest(convert_to(coalesce(v_prev,'') || '|' || v_content, 'utf8'), 'sha256'), 'hex') into v_expected;
    if v_expected <> v_row.chain_hash then
      ok := false;
      issue := 'chain_hash_mismatch';
      journal_entry_id := v_row.journal_entry_id;
      expected_chain_hash := v_expected;
      actual_chain_hash := v_row.chain_hash;
      return next;
      v_prev := v_row.chain_hash;
      continue;
    end if;

    v_prev := v_row.chain_hash;
  end loop;

  if v_seen = 0 then
    ok := true;
    issue := 'no_rows';
    journal_entry_id := null;
    expected_chain_hash := null;
    actual_chain_hash := null;
    return next;
    return;
  end if;

  ok := true;
  issue := 'ok';
  journal_entry_id := null;
  expected_chain_hash := null;
  actual_chain_hash := null;
  return next;
end;
$$;

revoke all on function public.verify_ledger_hash_chain(date, date, int) from public;
grant execute on function public.verify_ledger_hash_chain(date, date, int) to authenticated;

do $$
begin
  if to_regclass('public.ledger_snapshot_headers') is null then
    create table public.ledger_snapshot_headers (
      id uuid primary key default gen_random_uuid(),
      as_of date not null,
      snapshot_type text not null default 'ledger_balances' check (snapshot_type in ('ledger_balances','party_balances','open_items')),
      company_id uuid references public.companies(id) on delete set null,
      branch_id uuid references public.branches(id) on delete set null,
      notes text,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (as_of, snapshot_type, company_id, branch_id)
    );
    create index if not exists idx_ledger_snapshot_headers_asof on public.ledger_snapshot_headers(as_of desc, snapshot_type);
  end if;
end $$;

alter table public.ledger_snapshot_headers enable row level security;
drop policy if exists ledger_snapshot_headers_select on public.ledger_snapshot_headers;
create policy ledger_snapshot_headers_select on public.ledger_snapshot_headers
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ledger_snapshot_headers_insert on public.ledger_snapshot_headers;
create policy ledger_snapshot_headers_insert on public.ledger_snapshot_headers
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ledger_snapshot_headers_update_none on public.ledger_snapshot_headers;
create policy ledger_snapshot_headers_update_none on public.ledger_snapshot_headers
for update
using (false);
drop policy if exists ledger_snapshot_headers_delete_none on public.ledger_snapshot_headers;
create policy ledger_snapshot_headers_delete_none on public.ledger_snapshot_headers
for delete
using (false);

do $$
begin
  if to_regclass('public.ledger_snapshot_lines') is null then
    create table public.ledger_snapshot_lines (
      id uuid primary key default gen_random_uuid(),
      snapshot_id uuid not null references public.ledger_snapshot_headers(id) on delete cascade,
      account_id uuid references public.chart_of_accounts(id) on delete set null,
      currency_code text not null,
      cost_center_id uuid references public.cost_centers(id) on delete set null,
      dept_id uuid references public.departments(id) on delete set null,
      project_id uuid references public.projects(id) on delete set null,
      base_balance numeric not null,
      foreign_balance numeric,
      revalued_balance numeric,
      created_at timestamptz not null default now(),
      unique (snapshot_id, account_id, currency_code, cost_center_id, dept_id, project_id)
    );
    create index if not exists idx_ledger_snapshot_lines_snapshot on public.ledger_snapshot_lines(snapshot_id);
  end if;
end $$;

alter table public.ledger_snapshot_lines enable row level security;
drop policy if exists ledger_snapshot_lines_select on public.ledger_snapshot_lines;
create policy ledger_snapshot_lines_select on public.ledger_snapshot_lines
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ledger_snapshot_lines_insert on public.ledger_snapshot_lines;
create policy ledger_snapshot_lines_insert on public.ledger_snapshot_lines
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ledger_snapshot_lines_update_none on public.ledger_snapshot_lines;
create policy ledger_snapshot_lines_update_none on public.ledger_snapshot_lines
for update
using (false);
drop policy if exists ledger_snapshot_lines_delete_none on public.ledger_snapshot_lines;
create policy ledger_snapshot_lines_delete_none on public.ledger_snapshot_lines
for delete
using (false);

create or replace function public.create_ledger_snapshot(p_as_of date, p_company_id uuid default null, p_branch_id uuid default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_base text := public.get_base_currency();
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_as_of is null then
    raise exception 'as_of required';
  end if;

  insert into public.ledger_snapshot_headers(as_of, snapshot_type, company_id, branch_id, notes, created_by)
  values (p_as_of, 'ledger_balances', p_company_id, p_branch_id, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  on conflict (as_of, snapshot_type, company_id, branch_id) do update
  set notes = excluded.notes
  returning id into v_id;

  delete from public.ledger_snapshot_lines where snapshot_id = v_id;

  insert into public.ledger_snapshot_lines(snapshot_id, account_id, currency_code, cost_center_id, dept_id, project_id, base_balance, foreign_balance, revalued_balance)
  with lines as (
    select
      jl.account_id,
      upper(coalesce(jl.currency_code, v_base)) as currency_code,
      jl.cost_center_id,
      jl.dept_id,
      jl.project_id,
      sum(case when coa.normal_balance = 'credit' then (jl.credit - jl.debit) else (jl.debit - jl.credit) end) as base_balance,
      sum(
        case
          when jl.currency_code is null or upper(jl.currency_code) = upper(v_base) or jl.foreign_amount is null then null
          when coa.normal_balance = 'credit' then (case when jl.credit > 0 then coalesce(jl.foreign_amount,0) else -coalesce(jl.foreign_amount,0) end) * -1
          else (case when jl.debit > 0 then coalesce(jl.foreign_amount,0) else -coalesce(jl.foreign_amount,0) end)
        end
      ) as foreign_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where je.entry_date::date <= p_as_of
      and (p_company_id is null or je.company_id = p_company_id)
      and (p_branch_id is null or je.branch_id = p_branch_id)
    group by jl.account_id, upper(coalesce(jl.currency_code, v_base)), jl.cost_center_id, jl.dept_id, jl.project_id
  )
  select
    v_id,
    l.account_id,
    l.currency_code,
    l.cost_center_id,
    l.dept_id,
    l.project_id,
    coalesce(l.base_balance,0),
    l.foreign_balance,
    case
      when l.currency_code is null or upper(l.currency_code) = upper(v_base) or l.foreign_balance is null then coalesce(l.base_balance,0)
      else coalesce(l.foreign_balance,0) * public.get_fx_rate(l.currency_code, p_as_of, 'accounting')
    end as revalued_balance
  from lines l;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'ledger.snapshot',
    'accounting',
    v_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('snapshotId', v_id::text, 'asOf', p_as_of::text),
    'LOW',
    'LEDGER_SNAPSHOT'
  );

  return v_id;
end;
$$;

revoke all on function public.create_ledger_snapshot(date, uuid, uuid, text) from public;
grant execute on function public.create_ledger_snapshot(date, uuid, uuid, text) to authenticated;

do $$
begin
  if to_regclass('public.party_balance_snapshots') is null then
    create table public.party_balance_snapshots (
      id uuid primary key default gen_random_uuid(),
      snapshot_id uuid not null references public.ledger_snapshot_headers(id) on delete cascade,
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      item_role text,
      currency_code text not null,
      open_base_amount numeric not null,
      open_foreign_amount numeric,
      created_at timestamptz not null default now(),
      unique (snapshot_id, party_id, item_role, currency_code)
    );
    create index if not exists idx_party_balance_snapshots_snapshot on public.party_balance_snapshots(snapshot_id);
  end if;
end $$;

alter table public.party_balance_snapshots enable row level security;
drop policy if exists party_balance_snapshots_select on public.party_balance_snapshots;
create policy party_balance_snapshots_select on public.party_balance_snapshots
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists party_balance_snapshots_insert on public.party_balance_snapshots;
create policy party_balance_snapshots_insert on public.party_balance_snapshots
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists party_balance_snapshots_update_none on public.party_balance_snapshots;
create policy party_balance_snapshots_update_none on public.party_balance_snapshots
for update
using (false);
drop policy if exists party_balance_snapshots_delete_none on public.party_balance_snapshots;
create policy party_balance_snapshots_delete_none on public.party_balance_snapshots
for delete
using (false);

do $$
begin
  if to_regclass('public.open_item_snapshots') is null then
    create table public.open_item_snapshots (
      id uuid primary key default gen_random_uuid(),
      snapshot_id uuid not null references public.ledger_snapshot_headers(id) on delete cascade,
      open_item_id uuid not null references public.party_open_items(id) on delete restrict,
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      currency_code text not null,
      open_base_amount numeric not null,
      open_foreign_amount numeric,
      status text not null,
      occurred_at timestamptz not null,
      due_date date,
      item_role text,
      item_type text,
      created_at timestamptz not null default now(),
      unique (snapshot_id, open_item_id)
    );
    create index if not exists idx_open_item_snapshots_snapshot on public.open_item_snapshots(snapshot_id);
  end if;
end $$;

alter table public.open_item_snapshots enable row level security;
drop policy if exists open_item_snapshots_select on public.open_item_snapshots;
create policy open_item_snapshots_select on public.open_item_snapshots
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists open_item_snapshots_insert on public.open_item_snapshots;
create policy open_item_snapshots_insert on public.open_item_snapshots
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists open_item_snapshots_update_none on public.open_item_snapshots;
create policy open_item_snapshots_update_none on public.open_item_snapshots
for update
using (false);
drop policy if exists open_item_snapshots_delete_none on public.open_item_snapshots;
create policy open_item_snapshots_delete_none on public.open_item_snapshots
for delete
using (false);

create or replace function public.create_party_open_items_snapshot(p_as_of date, p_company_id uuid default null, p_branch_id uuid default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_as_of is null then
    raise exception 'as_of required';
  end if;

  insert into public.ledger_snapshot_headers(as_of, snapshot_type, company_id, branch_id, notes, created_by)
  values (p_as_of, 'open_items', p_company_id, p_branch_id, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  on conflict (as_of, snapshot_type, company_id, branch_id) do update
  set notes = excluded.notes
  returning id into v_id;

  delete from public.open_item_snapshots where snapshot_id = v_id;
  delete from public.party_balance_snapshots where snapshot_id = v_id;

  insert into public.open_item_snapshots(
    snapshot_id, open_item_id, party_id, currency_code, open_base_amount, open_foreign_amount, status,
    occurred_at, due_date, item_role, item_type
  )
  select
    v_id,
    poi.id,
    poi.party_id,
    poi.currency_code,
    poi.open_base_amount,
    poi.open_foreign_amount,
    poi.status,
    poi.occurred_at,
    poi.due_date,
    poi.item_role,
    poi.item_type
  from public.party_open_items poi
  join public.journal_entries je on je.id = poi.journal_entry_id
  where poi.occurred_at::date <= p_as_of
    and poi.status in ('open','partially_settled')
    and (p_company_id is null or je.company_id = p_company_id)
    and (p_branch_id is null or je.branch_id = p_branch_id);

  insert into public.party_balance_snapshots(snapshot_id, party_id, item_role, currency_code, open_base_amount, open_foreign_amount)
  select
    v_id,
    s.party_id,
    s.item_role,
    s.currency_code,
    sum(s.open_base_amount),
    sum(s.open_foreign_amount)
  from public.open_item_snapshots s
  where s.snapshot_id = v_id
  group by s.party_id, s.item_role, s.currency_code;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'open_items.snapshot',
    'accounting',
    v_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('snapshotId', v_id::text, 'asOf', p_as_of::text),
    'LOW',
    'OPEN_ITEMS_SNAPSHOT'
  );

  return v_id;
end;
$$;

revoke all on function public.create_party_open_items_snapshot(date, uuid, uuid, text) from public;
grant execute on function public.create_party_open_items_snapshot(date, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
