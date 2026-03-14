create or replace function public.review_cash_shift(
  p_shift_id uuid,
  p_status text,
  p_notes text default null
)
returns public.cash_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_actor_role text;
  v_prev_review_status text;
  v_prev_notes text;
  v_risk text;
  v_reason_code text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'invalid review status: %', p_status;
  end if;

  if p_status = 'rejected' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'ملاحظة الرفض مطلوبة';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null or (
    v_actor_role not in ('owner', 'manager')
    and not public.has_admin_permission('cashShifts.manage')
    and not public.has_admin_permission('accounting.approve')
  ) then
    raise exception 'ليس لديك صلاحية مراجعة الورديات';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if coalesce(v_shift.status, 'open') <> 'closed' then
    raise exception 'لا يمكن مراجعة وردية مفتوحة — يجب إغلاقها أولاً';
  end if;

  v_prev_review_status := coalesce(v_shift.review_status, 'pending');
  v_prev_notes := v_shift.notes;

  update public.cash_shifts
  set
    review_status = p_status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    notes = case
      when p_notes is not null and trim(p_notes) <> ''
        then coalesce(notes, '') || E'\n[مراجعة: ' || p_status || '] ' || trim(p_notes)
      else notes
    end
  where id = p_shift_id
  returning * into v_shift;

  v_risk := case
    when p_status = 'rejected' then 'HIGH'
    when p_status = 'approved' then 'MEDIUM'
    else 'LOW'
  end;

  v_reason_code := case
    when p_status = 'rejected' then 'SHIFT_REJECTED'
    when p_status = 'approved' then 'SHIFT_APPROVED'
    else 'SHIFT_REVIEW_UPDATE'
  end;

  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level, reason_code)
  values (
    'cash_shift_reviewed',
    'shift_reviews',
    concat('مراجعة وردية #', coalesce(v_shift.shift_number::text, substr(v_shift.id::text, 1, 8)), ': ', v_prev_review_status, ' → ', p_status),
    jsonb_build_object(
      'shiftId', v_shift.id,
      'shiftNumber', v_shift.shift_number,
      'cashierId', v_shift.cashier_id,
      'status', v_shift.status,
      'oldReviewStatus', v_prev_review_status,
      'newReviewStatus', p_status,
      'reviewNote', nullif(trim(coalesce(p_notes, '')), ''),
      'oldNotes', v_prev_notes,
      'newNotes', v_shift.notes,
      'reviewedAt', v_shift.reviewed_at,
      'reviewedBy', v_shift.reviewed_by
    ),
    auth.uid(),
    now(),
    v_risk,
    v_reason_code
  );

  return v_shift;
end;
$$;

revoke all on function public.review_cash_shift(uuid, text, text) from public;
grant execute on function public.review_cash_shift(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
