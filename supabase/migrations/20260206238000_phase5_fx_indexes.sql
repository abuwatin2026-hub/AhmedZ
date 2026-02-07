do $$
begin
  if to_regclass('public.payments') is not null then
    create index if not exists idx_payments_currency on public.payments(currency);
    create index if not exists idx_payments_currency_occurred on public.payments(currency, occurred_at desc);
  end if;
  if to_regclass('public.orders') is not null then
    create index if not exists idx_orders_currency on public.orders(currency);
  end if;
  if to_regclass('public.fx_rates') is not null then
    create index if not exists idx_fx_rates_currency on public.fx_rates(currency_code);
  end if;
end $$;

notify pgrst, 'reload schema';

