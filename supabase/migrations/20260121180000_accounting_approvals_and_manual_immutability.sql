alter table public.journal_entries
add column if not exists status text not null default 'posted';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'journal_entries'
      and c.conname = 'journal_entries_status_check'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_status_check
      check (status in ('draft','posted','voided'));
  end if;
end $$;

alter table public.journal_entries
add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.journal_entries
add column if not exists approved_at timestamptz;

alter table public.journal_entries
add column if not exists voided_by uuid references auth.users(id) on delete set null;

alter table public.journal_entries
add column if not exists voided_at timestamptz;

alter table public.journal_entries
add column if not exists void_reason text;

create or replace function public.trg_set_journal_entry_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_table = 'manual' then
    new.status := 'draft';
  else
    new.status := coalesce(nullif(new.status, ''), 'posted');
    if new.status = 'draft' then
      new.status := 'posted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_set_status on public.journal_entries;
create trigger trg_journal_entries_set_status
before insert on public.journal_entries
for each row execute function public.trg_set_journal_entry_status();

create or replace function public.trg_block_manual_entry_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'not allowed';
  end if;

  if current_setting('app.accounting_bypass', true) = '1' then
    return new;
  end if;

  if old.source_table = 'manual' and old.status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_journal_entries_block_manual_changes on public.journal_entries;
create trigger trg_journal_entries_block_manual_changes
before update or delete on public.journal_entries
for each row execute function public.trg_block_manual_entry_changes();

create or replace function public.trg_block_manual_line_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_table text;
  v_status text;
begin
  if current_setting('app.accounting_bypass', true) = '1' then
    return coalesce(new, old);
  end if;

  select je.source_table, je.status
  into v_source_table, v_status
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_source_table = 'manual' and v_status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_journal_lines_block_manual_changes on public.journal_lines;
create trigger trg_journal_lines_block_manual_changes
before update or delete on public.journal_lines
for each row execute function public.trg_block_manual_line_changes();

drop policy if exists journal_entries_admin_select on public.journal_entries;
drop policy if exists journal_entries_admin_write on public.journal_entries;
drop policy if exists journal_entries_admin_insert on public.journal_entries;
drop policy if exists journal_entries_admin_update on public.journal_entries;
drop policy if exists journal_entries_no_delete on public.journal_entries;

create policy journal_entries_select_accounting
on public.journal_entries
for select
using (public.has_admin_permission('accounting.view'));

create policy journal_entries_insert_accounting
on public.journal_entries
for insert
with check (public.has_admin_permission('accounting.manage'));

create policy journal_entries_update_accounting
on public.journal_entries
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create policy journal_entries_delete_none
on public.journal_entries
for delete
using (false);

drop policy if exists journal_lines_admin_select on public.journal_lines;
drop policy if exists journal_lines_admin_write on public.journal_lines;
drop policy if exists journal_lines_admin_insert on public.journal_lines;
drop policy if exists journal_lines_admin_update on public.journal_lines;
drop policy if exists journal_lines_no_delete on public.journal_lines;

create policy journal_lines_select_accounting
on public.journal_lines
for select
using (public.has_admin_permission('accounting.view'));

create policy journal_lines_insert_accounting
on public.journal_lines
for insert
with check (public.has_admin_permission('accounting.manage'));

create policy journal_lines_update_accounting
on public.journal_lines
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create policy journal_lines_delete_none
on public.journal_lines
for delete
using (false);

create or replace function public.approve_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_debit numeric;
  v_credit numeric;
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;

  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select *
  into v_entry
  from public.journal_entries je
  where je.id = p_entry_id
  for update;

  if not found then
    raise exception 'journal entry not found';
  end if;

  if v_entry.source_table <> 'manual' then
    raise exception 'not allowed';
  end if;

  if v_entry.status <> 'draft' then
    return v_entry.id;
  end if;

  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
  into v_debit, v_credit
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_debit <= 0 and v_credit <= 0 then
    raise exception 'empty entry';
  end if;

  if abs(coalesce(v_debit, 0) - coalesce(v_credit, 0)) > 1e-6 then
    raise exception 'entry not balanced';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'posted',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_entry_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'journal_entries.approve',
    'accounting',
    p_entry_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('entryId', p_entry_id::text),
    'MEDIUM',
    'ACCOUNTING_APPROVE'
  );

  return p_entry_id;
end;
$$;

revoke all on function public.approve_journal_entry(uuid) from public;
grant execute on function public.approve_journal_entry(uuid) to authenticated;

create or replace function public.create_manual_journal_entry(
  p_entry_date timestamptz,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_memo text;
  v_cost_center_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_memo := nullif(trim(coalesce(p_memo, '')), '');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_entry_date, now()),
    v_memo,
    'manual',
    null,
    null,
    auth.uid()
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
    v_cost_center_id := nullif(trim(coalesce(v_line->>'costCenterId', '')), '')::uuid;

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    if v_debit < 0 or v_credit < 0 then
      raise exception 'invalid debit/credit';
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'invalid line amounts';
    end if;

    v_account_id := public.get_account_id_by_code(v_account_code);
    if v_account_id is null then
      raise exception 'account not found %', v_account_code;
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      nullif(trim(coalesce(v_line->>'memo', '')), ''),
      v_cost_center_id
    );
  end loop;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'journal_entries.manual_draft',
    'accounting',
    v_entry_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('entryId', v_entry_id::text),
    'LOW',
    'ACCOUNTING_DRAFT'
  );

  return v_entry_id;
end;
$$;

revoke all on function public.create_manual_journal_entry(timestamptz, text, jsonb) from public;
revoke execute on function public.create_manual_journal_entry(timestamptz, text, jsonb) from anon;
grant execute on function public.create_manual_journal_entry(timestamptz, text, jsonb) to authenticated;

create or replace function public.void_journal_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_new_entry_id uuid;
  v_line record;
  v_reason text;
begin
  if not public.has_admin_permission('accounting.void') then
    raise exception 'not allowed';
  end if;
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if v_entry.source_table = 'manual' and v_entry.status = 'draft' then
    raise exception 'not allowed';
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then
    raise exception 'reason required';
  end if;
  perform public.set_audit_reason(v_reason);

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = v_reason
  where id = p_entry_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (now(), concat('Void ', p_entry_id::text, ' ', coalesce(v_entry.memo,'')), 'journal_entries', p_entry_id::text, 'void', auth.uid())
  returning id into v_new_entry_id;

  for v_line in
    select account_id, debit, credit, line_memo, cost_center_id from public.journal_lines where journal_entry_id = p_entry_id
  loop
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
    values (v_new_entry_id, v_line.account_id, v_line.credit, v_line.debit, coalesce(v_line.line_memo,'') || ' (reversal)', v_line.cost_center_id);
  end loop;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('journal_entries.void', 'accounting', p_entry_id::text, auth.uid(), now(),
          jsonb_build_object('voidOf', p_entry_id::text, 'newEntryId', v_new_entry_id::text),
          'HIGH', v_reason);
  return v_new_entry_id;
end;
$$;

revoke all on function public.void_journal_entry(uuid, text) from public;
grant execute on function public.void_journal_entry(uuid, text) to authenticated;

