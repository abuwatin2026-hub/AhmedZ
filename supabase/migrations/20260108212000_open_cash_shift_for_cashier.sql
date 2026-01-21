create or replace function public.open_cash_shift_for_cashier(
  p_cashier_id uuid,
  p_start_amount numeric
)
returns public.cash_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_exists int;
  v_shift public.cash_shifts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null or v_actor_role not in ('owner','manager') then
    raise exception 'not allowed';
  end if;

  if p_cashier_id is null then
    raise exception 'p_cashier_id is required';
  end if;

  if coalesce(p_start_amount, 0) < 0 then
    raise exception 'invalid start amount';
  end if;

  select count(1)
  into v_exists
  from public.cash_shifts s
  where s.cashier_id = p_cashier_id
    and coalesce(s.status, 'open') = 'open';

  if v_exists > 0 then
    raise exception 'cashier already has an open shift';
  end if;

  insert into public.cash_shifts(cashier_id, opened_at, start_amount, status)
  values (p_cashier_id, now(), coalesce(p_start_amount, 0), 'open')
  returning * into v_shift;

  return v_shift;
end;
$$;
revoke all on function public.open_cash_shift_for_cashier(uuid, numeric) from public;
grant execute on function public.open_cash_shift_for_cashier(uuid, numeric) to anon, authenticated;
