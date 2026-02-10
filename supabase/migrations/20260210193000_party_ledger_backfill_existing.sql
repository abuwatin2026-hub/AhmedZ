set app.allow_ledger_ddl = '1';

create or replace function public.backfill_party_ledger_for_existing_entries(
  p_batch int default 5000,
  p_only_party_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  if current_user <> 'postgres' then
    if auth.role() = 'service_role' then
      null;
    elsif public.has_admin_permission('accounting.manage') then
      null;
    else
      raise exception 'not allowed';
    end if;
  end if;

  update public.journal_lines jl
  set party_id = x.party_id
  from (
    select
      jl2.id as journal_line_id,
      public._resolve_party_for_entry(coalesce(je.source_table, ''), coalesce(je.source_id, '')) as party_id
    from public.journal_lines jl2
    join public.journal_entries je on je.id = jl2.journal_entry_id
    where jl2.party_id is null
      and exists (
        select 1
        from public.party_subledger_accounts psa
        where psa.account_id = jl2.account_id
          and psa.is_active = true
        limit 1
      )
      and (p_only_party_id is null or public._resolve_party_for_entry(coalesce(je.source_table, ''), coalesce(je.source_id, '')) = p_only_party_id)
  ) x
  where jl.id = x.journal_line_id
    and x.party_id is not null;

  for r in
    select distinct jl.journal_entry_id as entry_id
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.party_id is not null
      and exists (
        select 1
        from public.party_subledger_accounts psa
        where psa.account_id = jl.account_id
          and psa.is_active = true
        limit 1
      )
      and not exists (
        select 1
        from public.party_ledger_entries ple
        where ple.journal_line_id = jl.id
        limit 1
      )
      and (p_only_party_id is null or jl.party_id = p_only_party_id)
    order by jl.journal_entry_id asc
    limit greatest(1, coalesce(p_batch, 5000))
  loop
    perform public.insert_party_ledger_for_entry(r.entry_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.backfill_party_ledger_for_existing_entries(int, uuid) from public;
grant execute on function public.backfill_party_ledger_for_existing_entries(int, uuid) to authenticated;

do $$
declare
  v int;
begin
  v := public.backfill_party_ledger_for_existing_entries(5000, null);
end $$;

notify pgrst, 'reload schema';
