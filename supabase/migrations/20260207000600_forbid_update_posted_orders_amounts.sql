set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.orders') is null or to_regclass('public.journal_entries') is null then
    return;
  end if;

  create or replace function public.trg_forbid_update_posted_orders_amounts()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'orders'
        and je.source_id = old.id::text
        and je.source_event in ('invoiced','delivered')
      limit 1
    ) then
      if new.base_total is distinct from old.base_total then
        raise exception 'cannot modify posted order base_total; create reversal instead';
      end if;
      if new.currency is distinct from old.currency then
        raise exception 'cannot modify posted order currency; create reversal instead';
      end if;
      if new.fx_rate is distinct from old.fx_rate then
        raise exception 'cannot modify posted order fx_rate; create reversal instead';
      end if;
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists trg_orders_forbid_update_posted_amounts on public.orders;
  create trigger trg_orders_forbid_update_posted_amounts
  before update on public.orders
  for each row execute function public.trg_forbid_update_posted_orders_amounts();
end $$;

notify pgrst, 'reload schema';

