set app.allow_ledger_ddl = '1';

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
  v_base text;
begin
  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  v_base := public.get_base_currency();

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id;

  if not found then
    raise exception 'cash shift not found';
  end if;

  select
    coalesce(sum(
      case
        when p.direction = 'in' then coalesce(
          p.base_amount,
          case when upper(coalesce(p.currency,'')) = upper(v_base) then p.amount else null end,
          0
        )
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when p.direction = 'out' then coalesce(
          p.base_amount,
          case when upper(coalesce(p.currency,'')) = upper(v_base) then p.amount else null end,
          0
        )
        else 0
      end
    ), 0)
  into v_cash_in, v_cash_out
  from public.payments p
  where p.method = 'cash'
    and (
      p.shift_id = p_shift_id
      or (
        p.shift_id is null
        and p.created_by = v_shift.cashier_id
        and p.occurred_at >= coalesce(v_shift.opened_at, now())
        and p.occurred_at <= coalesce(v_shift.closed_at, now())
      )
    );

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0);
end;
$$;

revoke all on function public.calculate_cash_shift_expected(uuid) from public;
grant execute on function public.calculate_cash_shift_expected(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
