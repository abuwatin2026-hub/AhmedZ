create or replace function public.cancel_manual_journal_draft(p_entry_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_reason text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;
  select * into v_entry
  from public.journal_entries
  where id = p_entry_id
  for update;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if v_entry.source_table <> 'manual' or v_entry.status <> 'draft' then
    return v_entry.id;
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')), '');
  update public.journal_entries
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = coalesce(v_reason, 'CANCEL_DRAFT'),
      approved_by = null,
      approved_at = null
  where id = p_entry_id;
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'journal_entries.cancel_draft',
    'accounting',
    p_entry_id::text,
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object('entryId', p_entry_id::text, 'reason', v_reason)),
    'LOW',
    coalesce(v_reason, 'CANCEL_DRAFT')
  );
  return p_entry_id;
end;
$$;

revoke all on function public.cancel_manual_journal_draft(uuid, text) from public;
grant execute on function public.cancel_manual_journal_draft(uuid, text) to authenticated;
