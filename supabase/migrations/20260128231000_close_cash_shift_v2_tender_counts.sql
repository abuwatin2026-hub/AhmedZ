alter table public.cash_shifts
add column if not exists tender_counts jsonb;

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
begin
  v_shift := public.close_cash_shift_v2(p_shift_id, p_end_amount, p_notes, p_forced_reason, p_denomination_counts);

  if p_tender_counts is not null then
    update public.cash_shifts
    set tender_counts = p_tender_counts
    where id = p_shift_id
    returning * into v_shift;
  end if;

  return v_shift;
end;
$$;

revoke all on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb) from public;
grant execute on function public.close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb) to anon, authenticated;

