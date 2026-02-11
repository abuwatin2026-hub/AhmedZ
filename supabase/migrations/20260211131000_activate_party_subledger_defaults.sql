set app.allow_ledger_ddl = '1';

create or replace function public.ensure_party_subledger_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[] := array['1200','2010','2050','1350','1035','1210','2110'];
  v_code text;
  v_id uuid;
  v_role text;
begin
  foreach v_code in array v_codes loop
    v_id := public.get_account_id_by_code(v_code);
    if v_id is null then
      continue;
    end if;
    v_role := case v_code
      when '1200' then 'ar'
      when '2010' then 'ap'
      when '2050' then 'deposits'
      when '1350' then 'employee_advance'
      when '1035' then 'custodian'
      else 'other'
    end;
    insert into public.party_subledger_accounts(account_id, role, is_active)
    values (v_id, v_role, true)
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end loop;
end;
$$;

select public.ensure_party_subledger_defaults();

notify pgrst, 'reload schema';
