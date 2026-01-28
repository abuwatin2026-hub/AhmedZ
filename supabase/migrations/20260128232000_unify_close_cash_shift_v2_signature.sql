alter table public.cash_shifts
add column if not exists tender_counts jsonb;

drop function if exists public.close_cash_shift_v2(uuid, numeric, text, text, jsonb);
drop function if exists public.close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb);

create or replace function public.close_cash_shift_v2(
  p_shift_id uuid,
  p_end_amount numeric,
  p_notes text default null,
  p_forced_reason text default null,
  p_denomination_counts jsonb default null,
  p_tender_counts jsonb default null
)
returns public.cash_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_expected numeric;
  v_end numeric;
  v_actor_role text;
  v_diff numeric;
  v_forced boolean;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null then
    raise exception 'not allowed';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  if coalesce(v_shift.status, 'open') <> 'open' then
    return v_shift;
  end if;

  v_end := coalesce(p_end_amount, 0);
  if v_end < 0 then
    raise exception 'invalid end amount';
  end if;

  v_expected := public.calculate_cash_shift_expected(p_shift_id);
  v_diff := v_end - v_expected;
  v_forced := abs(v_diff) > 0.01;
  v_reason := nullif(trim(coalesce(p_forced_reason, '')), '');

  if v_forced and v_reason is null then
    raise exception 'يرجى إدخال سبب الإغلاق عند وجود فرق.';
  end if;

  update public.cash_shifts
  set closed_at = now(),
      end_amount = v_end,
      expected_amount = v_expected,
      difference = v_diff,
      status = 'closed',
      notes = nullif(coalesce(p_notes, ''), ''),
      denomination_counts = coalesce(p_denomination_counts, denomination_counts),
      tender_counts = coalesce(p_tender_counts, tender_counts),
      forced_close = v_forced,
      forced_close_reason = v_reason,
      closed_by = auth.uid()
  where id = p_shift_id
  returning * into v_shift;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'cash_shift_close',
    'cash_shifts',
    'Cash shift closed',
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'shiftId', p_shift_id::text,
      'endAmount', v_end,
      'expectedAmount', v_expected,
      'difference', v_diff,
      'forced', v_forced,
      'forcedReason', v_reason,
      'notes', nullif(coalesce(p_notes, ''), ''),
      'denominationCounts', p_denomination_counts,
      'tenderCounts', p_tender_counts
    )),
    case when v_forced then 'HIGH' else 'MEDIUM' end,
    case when v_forced then 'SHIFT_FORCED_CLOSE' else 'SHIFT_CLOSE' end
  );

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$$;

revoke all on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb) from public;
grant execute on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb) to anon, authenticated;

