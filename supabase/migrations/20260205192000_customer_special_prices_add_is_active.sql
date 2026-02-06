do $$
begin
  if to_regclass('public.customer_special_prices') is not null then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_special_prices'
        and column_name = 'is_active'
    ) then
      alter table public.customer_special_prices
        add column is_active boolean not null default true;
    end if;
  end if;
end $$;
