do $$
begin
  if to_regclass('public.accounting_light_entries') is not null then
    grant select on table public.accounting_light_entries to anon, authenticated;
  end if;
exception when others then
  null;
end $$;
