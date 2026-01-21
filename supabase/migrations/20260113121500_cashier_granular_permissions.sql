create or replace function public.has_admin_permission(p text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_perms text[];
begin
  select au.role, au.permissions
  into v_role, v_perms
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_role is null then
    return false;
  end if;

  if v_role in ('owner', 'manager') then
    return true;
  end if;

  if v_perms is not null and p = any(v_perms) then
    return true;
  end if;

  if v_role = 'cashier' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid',
      'orders.createInStore',
      'cashShifts.open',
      'cashShifts.viewOwn',
      'cashShifts.closeSelf',
      'cashShifts.cashIn',
      'cashShifts.cashOut'
    ]);
  end if;

  if v_role = 'delivery' then
    return p = any(array[
      'profile.view',
      'orders.view',
      'orders.updateStatus.delivery'
    ]);
  end if;

  if v_role = 'employee' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid'
    ]);
  end if;

  return false;
end;
$$;
revoke all on function public.has_admin_permission(text) from public;
grant execute on function public.has_admin_permission(text) to anon, authenticated;
create or replace function public.record_shift_cash_movement(
  p_shift_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text default null,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_amount numeric;
  v_dir text;
  v_actor_role text;
  v_payment_id uuid;
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

  if coalesce(v_shift.status, 'open') <> 'open' then
    raise exception 'cash shift is not open';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  v_dir := lower(nullif(trim(coalesce(p_direction, '')), ''));
  if v_dir not in ('in', 'out') then
    raise exception 'invalid direction';
  end if;

  if auth.uid() = v_shift.cashier_id then
    if v_dir = 'in' and not public.has_admin_permission('cashShifts.cashIn') then
      raise exception 'not allowed';
    end if;
    if v_dir = 'out' and not public.has_admin_permission('cashShifts.cashOut') then
      raise exception 'not allowed';
    end if;
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_dir = 'out' and v_reason is null then
    raise exception 'يرجى إدخال سبب الصرف.';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    v_dir,
    'cash',
    v_amount,
    'YER',
    'cash_shifts',
    p_shift_id::text,
    coalesce(p_occurred_at, now()),
    auth.uid(),
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'reason', v_reason, 'kind', 'cash_movement')),
    p_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    case when v_dir = 'in' then 'cash_shift_cash_in' else 'cash_shift_cash_out' end,
    'cash_shifts',
    case when v_dir = 'in' then 'Cash movement in' else 'Cash movement out' end,
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'paymentId', v_payment_id::text, 'amount', v_amount, 'direction', v_dir, 'reason', v_reason)),
    'MEDIUM',
    'SHIFT_CASH_MOVE'
  );
end;
$$;
revoke all on function public.record_shift_cash_movement(uuid, text, numeric, text, timestamptz) from public;
grant execute on function public.record_shift_cash_movement(uuid, text, numeric, text, timestamptz) to anon, authenticated;
create or replace function public.close_cash_shift_v2(
  p_shift_id uuid,
  p_end_amount numeric,
  p_notes text default null,
  p_forced_reason text default null,
  p_denomination_counts jsonb default null
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

  if auth.uid() = v_shift.cashier_id and v_actor_role = 'cashier' and not public.has_admin_permission('cashShifts.closeSelf') then
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
      'denominationCounts', p_denomination_counts
    )),
    case when v_forced then 'HIGH' else 'MEDIUM' end,
    case when v_forced then 'SHIFT_FORCED_CLOSE' else 'SHIFT_CLOSE' end
  );

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$$;
revoke all on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb) from public;
grant execute on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb) to anon, authenticated;
do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;

  update public.admin_users au
  set permissions = (
    select array_agg(distinct p)
    from unnest(
      au.permissions
      || array['cashShifts.viewOwn', 'cashShifts.closeSelf', 'cashShifts.cashIn', 'cashShifts.cashOut']
    ) p
  )
  where au.role = 'cashier'
    and au.permissions is not null
    and cardinality(au.permissions) > 0
    and (
      ('cashShifts.manage' = any(au.permissions))
      or ('cashShifts.open' = any(au.permissions))
    );
end $$;
