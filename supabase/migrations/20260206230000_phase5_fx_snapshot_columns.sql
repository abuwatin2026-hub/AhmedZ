set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.journal_entries') is not null then
    begin
      alter table public.journal_entries add column currency_code text;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.journal_entries add column fx_rate numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.journal_entries add column foreign_amount numeric;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

