create unique index if not exists uq_cash_shifts_open_per_cashier
on public.cash_shifts(cashier_id)
where status = 'open';
drop policy if exists "Managers can update open shifts" on public.cash_shifts;
create policy "Managers can update open shifts" on public.cash_shifts
for update using (
  status = 'open'
  and exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner', 'manager')
  )
  and cash_shifts.cashier_id is not null
)
with check (
  status in ('open', 'closed')
  and exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner', 'manager')
  )
);
create or replace function public.guard_admin_users_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if auth.uid() = old.auth_user_id and not public.is_owner() then
    if new.role is distinct from old.role then
      raise exception 'ليس لديك صلاحية لتغيير الدور.';
    end if;
    if new.permissions is distinct from old.permissions then
      raise exception 'ليس لديك صلاحية لتغيير الصلاحيات.';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'ليس لديك صلاحية لتغيير حالة الحساب.';
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_admin_users_guard on public.admin_users;
create trigger trg_admin_users_guard
before update on public.admin_users
for each row execute function public.guard_admin_users_update();
drop policy if exists admin_users_self_update_profile on public.admin_users;
create policy admin_users_self_update_profile
on public.admin_users
for update
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);
drop policy if exists admin_users_manager_insert on public.admin_users;
create policy admin_users_manager_insert
on public.admin_users
for insert
with check (
  exists (
    select 1
    from public.admin_users me
    where me.auth_user_id = auth.uid()
      and me.is_active = true
      and me.role in ('owner', 'manager')
  )
  and role in ('manager', 'employee', 'delivery')
);
drop policy if exists admin_users_manager_update on public.admin_users;
create policy admin_users_manager_update
on public.admin_users
for update
using (
  exists (
    select 1
    from public.admin_users me
    where me.auth_user_id = auth.uid()
      and me.is_active = true
      and me.role in ('owner', 'manager')
  )
  and auth_user_id <> auth.uid()
  and role <> 'owner'
)
with check (role <> 'owner');
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
    and p.created_by = v_shift.cashier_id
    and p.occurred_at >= coalesce(v_shift.opened_at, now())
    and p.occurred_at <= coalesce(v_shift.closed_at, now());

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0);
end;
$$;
revoke all on function public.calculate_cash_shift_expected(uuid) from public;
grant execute on function public.calculate_cash_shift_expected(uuid) to anon, authenticated;
create or replace function public.close_cash_shift(
  p_shift_id uuid,
  p_end_amount numeric,
  p_notes text
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

  if auth.uid() <> v_shift.cashier_id and v_actor_role not in ('owner', 'manager') then
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

  update public.cash_shifts
  set closed_at = now(),
      end_amount = v_end,
      expected_amount = v_expected,
      difference = v_end - v_expected,
      status = 'closed',
      notes = nullif(coalesce(p_notes, ''), '')
  where id = p_shift_id
  returning * into v_shift;

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$$;
revoke all on function public.close_cash_shift(uuid, numeric, text) from public;
grant execute on function public.close_cash_shift(uuid, numeric, text) to anon, authenticated;
