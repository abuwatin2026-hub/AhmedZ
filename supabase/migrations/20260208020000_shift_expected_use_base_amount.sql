create or replace function public.calculate_cash_shift_expected(p_shift_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_cash_in_base numeric;
  v_cash_out_base numeric;
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
    coalesce(sum(case when p.direction = 'in' then coalesce(p.base_amount, p.amount, 0) else 0 end), 0),
    coalesce(sum(case when p.direction = 'out' then coalesce(p.base_amount, p.amount, 0) else 0 end), 0)
  into v_cash_in_base, v_cash_out_base
  from public.payments p
  where p.method = 'cash'
    and p.shift_id = p_shift_id;

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in_base, 0) - coalesce(v_cash_out_base, 0);
end;
$$;

revoke all on function public.calculate_cash_shift_expected(uuid) from public;
grant execute on function public.calculate_cash_shift_expected(uuid) to authenticated;

select pg_sleep(0.3);
notify pgrst, 'reload schema';

