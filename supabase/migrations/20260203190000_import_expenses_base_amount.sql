do $$
begin
  if to_regclass('public.import_expenses') is not null then
    begin
      alter table public.import_expenses
        add column base_amount numeric generated always as (coalesce(amount,0) * coalesce(exchange_rate,1)) stored;
    exception when duplicate_column then
      null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
