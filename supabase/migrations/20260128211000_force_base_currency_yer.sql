insert into public.currencies(code, name, is_base)
values ('YER', 'Yemeni Rial', true)
on conflict (code)
do update set name = excluded.name;

update public.currencies
set is_base = false
where code <> 'YER'
  and is_base = true;

update public.currencies
set is_base = true
where code = 'YER'
  and is_base is distinct from true;

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
values ('YER', 1, current_date, 'operational')
on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
values ('YER', 1, current_date, 'accounting')
on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

