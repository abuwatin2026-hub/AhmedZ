-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260318020000_voucher_approval_workflow.sql
--
-- Implements Maker/Checker voucher approval workflow:
-- 1. Extend journal_entries status to include 'pending_approval'
-- 2. Function: submit_voucher_for_approval (Maker → pending_approval)
-- 3. Function: approve_voucher (Checker → posted)
-- 4. Function: reject_voucher (Checker → draft, with reason)
-- 5. Enforce: only 'draft' vouchers can be submitted; only owner/manager can approve
-- 6. Block posting manual vouchers directly (must go through approval)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Add pending_approval & rejected to allowed statuses ────────
set app.allow_ledger_ddl = '1';

alter table public.journal_entries
  drop constraint if exists journal_entries_status_check;

alter table public.journal_entries
  add constraint journal_entries_status_check
  check (status in ('draft', 'pending_approval', 'posted', 'voided', 'rejected'));

-- ─── 2. Voucher approval log table ────────────────────────────────
create table if not exists public.voucher_approval_log (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.journal_entries(id),
  action        text not null,  -- 'submitted', 'approved', 'rejected', 'recalled'
  performed_by  uuid references auth.users(id),
  reason        text,
  previous_status text,
  new_status    text,
  created_at    timestamptz not null default now()
);

comment on table public.voucher_approval_log is
  'Immutable audit trail for voucher Maker/Checker approval workflow';

alter table public.voucher_approval_log enable row level security;
create policy "accounting_view" on public.voucher_approval_log
  for select using (public.has_admin_permission('accounting.view'));
create policy "system_insert" on public.voucher_approval_log
  for insert with check (true);

-- ─── 3. Submit voucher for approval (Maker) ───────────────────────
create or replace function public.submit_voucher_for_approval(
  p_entry_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entry record;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;
  if v_entry.source_table <> 'manual' then
    raise exception 'لا يمكن تقديم قيود النظام للاعتماد — فقط السندات اليدوية';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'القيد يجب أن يكون مسودة (draft) للتقديم. الحالة الحالية: %', v_entry.status;
  end if;

  -- Check entry is balanced before submitting
  declare v_diff numeric;
  begin
    select abs(sum(debit) - sum(credit)) into v_diff
    from public.journal_lines where journal_entry_id = p_entry_id;
    if coalesce(v_diff, 0) > 0.01 then
      raise exception 'القيد غير متوازن (فرق: %) — ضبطه قبل التقديم', v_diff;
    end if;
  end;

  update public.journal_entries
  set status = 'pending_approval',
      memo = case when p_notes is not null then memo || ' | ملاحظة: ' || p_notes else memo end
  where id = p_entry_id;

  insert into public.voucher_approval_log(entry_id, action, performed_by, reason, previous_status, new_status)
  values (p_entry_id, 'submitted', auth.uid(), p_notes, 'draft', 'pending_approval');

  return jsonb_build_object('success', true, 'status', 'pending_approval', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.submit_voucher_for_approval(uuid, text) from public;
grant execute on function public.submit_voucher_for_approval(uuid, text) to authenticated;

-- ─── 4. Approve voucher (Checker — owner/manager only) ────────────
create or replace function public.approve_voucher(
  p_entry_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entry record;
begin
  -- Only owner or manager can approve
  if not (public.is_owner() or public.has_admin_permission('accounting.manage')) then
    raise exception 'صلاحية الاعتماد مخصصة للمدير أو المالك فقط';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;
  if v_entry.status <> 'pending_approval' then
    raise exception 'القيد يجب أن يكون في انتظار الاعتماد. الحالة الحالية: %', v_entry.status;
  end if;

  -- Cannot approve own submission (Maker ≠ Checker)
  if v_entry.created_by = auth.uid() and not public.is_owner() then
    raise exception 'لا يمكن اعتماد قيد أنشأته بنفسك (مبدأ Maker/Checker)';
  end if;

  -- Post the entry
  update public.journal_entries
  set status = 'posted'
  where id = p_entry_id;

  insert into public.voucher_approval_log(entry_id, action, performed_by, reason, previous_status, new_status)
  values (p_entry_id, 'approved', auth.uid(), p_notes, 'pending_approval', 'posted');

  return jsonb_build_object('success', true, 'status', 'posted', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.approve_voucher(uuid, text) from public;
grant execute on function public.approve_voucher(uuid, text) to authenticated;

-- ─── 5. Reject voucher (returns to draft with reason) ─────────────
create or replace function public.reject_voucher(
  p_entry_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entry record;
begin
  if not (public.is_owner() or public.has_admin_permission('accounting.manage')) then
    raise exception 'صلاحية الرفض مخصصة للمدير أو المالك فقط';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;
  if v_entry.status <> 'pending_approval' then
    raise exception 'القيد يجب أن يكون في انتظار الاعتماد للرفض';
  end if;

  update public.journal_entries
  set status = 'draft'  -- Returns to draft for correction
  where id = p_entry_id;

  insert into public.voucher_approval_log(entry_id, action, performed_by, reason, previous_status, new_status)
  values (p_entry_id, 'rejected', auth.uid(), p_reason, 'pending_approval', 'draft');

  return jsonb_build_object('success', true, 'status', 'draft', 'reason', p_reason);
end;
$$;

revoke all on function public.reject_voucher(uuid, text) from public;
grant execute on function public.reject_voucher(uuid, text) to authenticated;

-- ─── 6. Recall voucher (Maker can recall before approval) ─────────
create or replace function public.recall_voucher(p_entry_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_entry record;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;
  if v_entry.status <> 'pending_approval' then
    raise exception 'يمكن سحب القيد فقط عندما يكون في انتظار الاعتماد';
  end if;
  -- Only original creator or owner can recall
  if v_entry.created_by <> auth.uid() and not public.is_owner() then
    raise exception 'يمكن فقط منشئ القيد أو المالك سحبه';
  end if;

  update public.journal_entries set status = 'draft' where id = p_entry_id;

  insert into public.voucher_approval_log(entry_id, action, performed_by, previous_status, new_status)
  values (p_entry_id, 'recalled', auth.uid(), 'pending_approval', 'draft');

  return jsonb_build_object('success', true, 'status', 'draft');
end;
$$;

revoke all on function public.recall_voucher(uuid) from public;
grant execute on function public.recall_voucher(uuid) to authenticated;

-- ─── 7. Pending vouchers query (for approval dashboard) ───────────
create or replace function public.get_pending_vouchers()
returns table(
  id uuid, entry_date timestamptz, memo text, status text,
  document_number text, total_debit numeric, currency_code text,
  created_by uuid, created_at timestamptz, submitted_at timestamptz
)
language sql security definer set search_path = public
as $$
  select je.id, je.entry_date, je.memo, je.status,
         je.source_id as document_number,
         coalesce(sum(jl.debit), 0) as total_debit,
         je.currency_code,
         je.created_by, je.created_at,
         val.created_at as submitted_at
  from public.journal_entries je
  left join public.journal_lines jl on jl.journal_entry_id = je.id
  left join (
    select entry_id, max(created_at) as created_at
    from public.voucher_approval_log
    where action = 'submitted'
    group by entry_id
  ) val on val.entry_id = je.id
  where je.source_table = 'manual'
    and je.status = 'pending_approval'
  group by je.id, je.entry_date, je.memo, je.status,
           je.source_id, je.currency_code, je.created_by, je.created_at, val.created_at
  order by val.created_at asc nulls last;
$$;

grant execute on function public.get_pending_vouchers() to authenticated;

notify pgrst, 'reload schema';
