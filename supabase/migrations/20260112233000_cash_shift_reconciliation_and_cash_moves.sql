-- Cash shift reconciliation: denomination counts, forced close reason, cash in/out, and stricter shift linking

alter table public.cash_shifts
add column if not exists denomination_counts jsonb;
alter table public.cash_shifts
add column if not exists forced_close_reason text;
alter table public.cash_shifts
add column if not exists forced_close boolean default false;
alter table public.cash_shifts
add column if not exists closed_by uuid references auth.users(id);
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payments'::regclass
      and c.conname = 'payments_cash_requires_shift'
  ) then
    execute 'alter table public.payments add constraint payments_cash_requires_shift check (method <> ''cash'' or shift_id is not null) not valid';
  end if;
end;
$$;
update public.payments p
set shift_id = (
  select cs.id
  from public.cash_shifts cs
  where cs.cashier_id = p.created_by
    and p.occurred_at >= cs.opened_at
    and p.occurred_at <= coalesce(cs.closed_at, p.occurred_at)
  order by cs.opened_at desc
  limit 1
)
where p.shift_id is null
  and p.created_by is not null
  and p.occurred_at is not null;
create or replace function public._resolve_open_shift_for_cash(p_operator uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
begin
  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = p_operator
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  return v_shift_id;
end;
$$;
create or replace function public.calculate_cash_shift_expected(p_shift_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_cash_in numeric;
  v_cash_out numeric;
begin
  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id;

  if not found then
    raise exception 'cash shift not found';
  end if;

  select
    coalesce(sum(case when p.direction = 'in' then p.amount else 0 end), 0),
    coalesce(sum(case when p.direction = 'out' then p.amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.payments p
  where p.method = 'cash'
    and p.shift_id = p_shift_id;

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0);
end;
$$;
revoke all on function public.calculate_cash_shift_expected(uuid) from public;
grant execute on function public.calculate_cash_shift_expected(uuid) to anon, authenticated;
create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_idempotency_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_total numeric;
  v_paid numeric;
  v_idempotency text;
  v_shift_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select coalesce(nullif((o.data->>'total')::numeric, null), 0)
  into v_total
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in';

  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method in ('card', 'online') then
    v_method := 'network';
  elsif v_method in ('bank', 'bank_transfer') then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  if v_idempotency is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_shift_id
    );
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_idempotency,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do update set
      method = excluded.method,
      amount = excluded.amount,
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id);
  end if;
end;
$$;
revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) to anon, authenticated;
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

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
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
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'reason', nullif(trim(coalesce(p_reason, '')), ''), 'kind', 'cash_movement')),
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
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'paymentId', v_payment_id::text, 'amount', v_amount, 'direction', v_dir, 'reason', nullif(trim(coalesce(p_reason, '')), ''))),
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
