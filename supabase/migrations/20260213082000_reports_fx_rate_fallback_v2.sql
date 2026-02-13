set app.allow_ledger_ddl = '1';

create or replace function public.order_fx_rate(
  p_currency text,
  p_date timestamptz,
  p_fx_rate numeric
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(p_fx_rate, 0),
    public.get_fx_rate(
      coalesce(nullif(btrim(coalesce(p_currency, '')), ''), public.get_base_currency()),
      p_date::date,
      'operational'
    ),
    1
  );
$$;

revoke all on function public.order_fx_rate(text, timestamptz, numeric) from public;
grant execute on function public.order_fx_rate(text, timestamptz, numeric) to authenticated;

notify pgrst, 'reload schema';
