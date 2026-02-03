alter table public.customers
add column if not exists preferred_currency text;

alter table public.suppliers
add column if not exists preferred_currency text;

do $$
begin
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='currencies') then
    alter table public.customers
      drop constraint if exists customers_preferred_currency_fk;
    alter table public.customers
      add constraint customers_preferred_currency_fk
      foreign key (preferred_currency) references public.currencies(code)
      on update cascade on delete set null;

    alter table public.suppliers
      drop constraint if exists suppliers_preferred_currency_fk;
    alter table public.suppliers
      add constraint suppliers_preferred_currency_fk
      foreign key (preferred_currency) references public.currencies(code)
      on update cascade on delete set null;
  end if;
end $$;

create index if not exists idx_customers_preferred_currency on public.customers(preferred_currency);
create index if not exists idx_suppliers_preferred_currency on public.suppliers(preferred_currency);

notify pgrst, 'reload schema';
