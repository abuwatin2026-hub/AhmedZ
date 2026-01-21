create or replace function public.can_manage_expenses()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role in ('owner','manager')
        or ('expenses.manage' = any(coalesce(au.permissions, '{}'::text[])))
      )
  );
$$;
revoke all on function public.can_manage_expenses() from public;
grant execute on function public.can_manage_expenses() to anon, authenticated;
create or replace function public.can_manage_stock()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role in ('owner','manager')
        or ('stock.manage' = any(coalesce(au.permissions, '{}'::text[])))
      )
  );
$$;
revoke all on function public.can_manage_stock() from public;
grant execute on function public.can_manage_stock() to anon, authenticated;
drop trigger if exists trg_audit_payments on public.payments;
create trigger trg_audit_payments
after insert or update or delete on public.payments
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_journal_entries on public.journal_entries;
create trigger trg_audit_journal_entries
after insert or update or delete on public.journal_entries
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_journal_lines on public.journal_lines;
create trigger trg_audit_journal_lines
after insert or update or delete on public.journal_lines
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses
after insert or update or delete on public.expenses
for each row execute function public.audit_row_change();
alter table public.payments enable row level security;
drop policy if exists payments_admin_write on public.payments;
drop policy if exists payments_admin_select on public.payments;
create policy payments_admin_select
on public.payments
for select
using (public.is_admin());
create policy payments_admin_insert
on public.payments
for insert
with check (public.is_admin());
create policy payments_admin_update
on public.payments
for update
using (public.is_admin())
with check (public.is_admin());
drop policy if exists payments_no_delete on public.payments;
create policy payments_no_delete
on public.payments
for delete
using (false);
alter table public.journal_entries enable row level security;
drop policy if exists journal_entries_admin_select on public.journal_entries;
drop policy if exists journal_entries_admin_write on public.journal_entries;
create policy journal_entries_admin_select
on public.journal_entries
for select
using (public.is_admin());
create policy journal_entries_admin_insert
on public.journal_entries
for insert
with check (public.is_admin());
create policy journal_entries_admin_update
on public.journal_entries
for update
using (public.is_admin())
with check (public.is_admin());
drop policy if exists journal_entries_no_delete on public.journal_entries;
create policy journal_entries_no_delete
on public.journal_entries
for delete
using (false);
alter table public.journal_lines enable row level security;
drop policy if exists journal_lines_admin_select on public.journal_lines;
drop policy if exists journal_lines_admin_write on public.journal_lines;
create policy journal_lines_admin_select
on public.journal_lines
for select
using (public.is_admin());
create policy journal_lines_admin_insert
on public.journal_lines
for insert
with check (public.is_admin());
create policy journal_lines_admin_update
on public.journal_lines
for update
using (public.is_admin())
with check (public.is_admin());
drop policy if exists journal_lines_no_delete on public.journal_lines;
create policy journal_lines_no_delete
on public.journal_lines
for delete
using (false);
alter table public.expenses enable row level security;
drop policy if exists expenses_admin_select on public.expenses;
drop policy if exists expenses_admin_write on public.expenses;
drop policy if exists expenses_select_manage on public.expenses;
drop policy if exists expenses_insert_manage on public.expenses;
drop policy if exists expenses_update_manage on public.expenses;
drop policy if exists expenses_no_delete on public.expenses;
create policy expenses_select_manage
on public.expenses
for select
using (public.can_manage_expenses());
create policy expenses_insert_manage
on public.expenses
for insert
with check (public.can_manage_expenses());
create policy expenses_update_manage
on public.expenses
for update
using (public.can_manage_expenses())
with check (public.can_manage_expenses());
create policy expenses_no_delete
on public.expenses
for delete
using (false);
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
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then
    raise exception 'reason required';
  end if;
  perform public.set_audit_reason(v_reason);
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
create or replace function public.reverse_payment_journal(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_existing_id uuid;
  v_new_entry_id uuid;
begin
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')), '');
  if v_reason is null then
    raise exception 'reason required';
  end if;
  perform public.set_audit_reason(v_reason);
  select id into v_existing_id
  from public.journal_entries
  where source_table = 'payments' and source_id = p_payment_id::text
  order by created_at desc
  limit 1;
  if v_existing_id is null then
    raise exception 'payment journal not found';
  end if;
  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (now(), concat('Void payment ', p_payment_id::text), 'payments', p_payment_id::text, 'void', auth.uid())
  returning id into v_new_entry_id;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select v_new_entry_id, account_id, credit, debit, coalesce(line_memo,'') || ' (reversal)'
  from public.journal_lines
  where journal_entry_id = v_existing_id;
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('payments.void', 'payments', p_payment_id::text, auth.uid(), now(),
          jsonb_build_object('voidOfJournal', v_existing_id::text, 'newEntryId', v_new_entry_id::text),
          'HIGH', v_reason);
  return v_new_entry_id;
end;
$$;
revoke all on function public.reverse_payment_journal(uuid, text) from public;
grant execute on function public.reverse_payment_journal(uuid, text) to authenticated;
