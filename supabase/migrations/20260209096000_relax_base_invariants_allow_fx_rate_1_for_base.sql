set app.allow_ledger_ddl = '1';

create or replace function public.trg_journal_lines_sar_base_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.get_base_currency();
begin
  if new.currency_code is not null and upper(new.currency_code) = upper(v_base) then
    if coalesce(new.foreign_amount, 0) <> 0 then
      raise exception 'base journal line cannot include foreign_amount';
    end if;
    if new.fx_rate is not null and abs(new.fx_rate - 1) > 1e-12 then
      raise exception 'base journal line fx_rate must be 1 or null';
    end if;
    return new;
  end if;

  if new.currency_code is null then
    if coalesce(new.foreign_amount, 0) <> 0 then
      raise exception 'base journal line cannot include foreign_amount';
    end if;
    if new.fx_rate is not null then
      raise exception 'base journal line cannot include fx_rate';
    end if;
    return new;
  end if;

  if upper(new.currency_code) <> upper(v_base) then
    if new.fx_rate is not null and abs(new.fx_rate - 1) <= 1e-12 then
      raise exception 'fx_rate=1 is not allowed for non-base currency';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.journal_lines') is not null then
    drop trigger if exists trg0_journal_lines_sar_base_invariants on public.journal_lines;
    create trigger trg0_journal_lines_sar_base_invariants
    before insert on public.journal_lines
    for each row execute function public.trg_journal_lines_sar_base_invariants();
  end if;
end $$;

notify pgrst, 'reload schema';

