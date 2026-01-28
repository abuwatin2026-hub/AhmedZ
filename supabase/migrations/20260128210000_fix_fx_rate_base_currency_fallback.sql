create table if not exists public.currencies (
  code text primary key,
  name text not null,
  is_base boolean not null default false
);

create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currencies(code),
  rate numeric not null,
  rate_date date not null,
  rate_type text not null check (rate_type in ('operational','accounting')),
  unique(currency_code, rate_date, rate_type)
);

create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_base text;
  v_type text;
  v_date date;
  v_rate numeric;
begin
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_date := coalesce(p_date, current_date);
  v_base := upper(nullif(btrim(coalesce(public.get_base_currency(), '')), ''));

  if v_currency is null then
    v_currency := v_base;
  end if;
  if v_type is null then
    v_type := 'operational';
  end if;

  if v_base is not null and v_currency = v_base then
    return 1;
  end if;

  select fr.rate
  into v_rate
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date <= v_date
  order by fr.rate_date desc
  limit 1;

  return v_rate;
end;
$$;

insert into public.currencies(code, name, is_base)
select 'YER', 'Yemeni Rial', true
where not exists (select 1 from public.currencies where is_base = true);

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
select c.code, 1, current_date, 'operational'
from public.currencies c
where c.is_base = true
on conflict do nothing;

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
select c.code, 1, current_date, 'accounting'
from public.currencies c
where c.is_base = true
on conflict do nothing;

