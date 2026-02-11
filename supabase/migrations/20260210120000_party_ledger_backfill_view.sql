select set_config('app.allow_ledger_ddl', '1', true);

create or replace function public.backfill_party_ledger_entries_for_party(
  p_party_id uuid,
  p_batch integer default 5000
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_limit integer := greatest(1, coalesce(p_batch, 5000));
  r record;
begin
  if p_party_id is null then
    raise exception 'party_id is required';
  end if;

  if current_user <> 'postgres' then
    if auth.role() = 'service_role' then
      null;
    elsif public.has_admin_permission('accounting.view') then
      null;
    else
      raise exception 'not allowed';
    end if;
  end if;

  for r in
    select distinct jl.journal_entry_id as journal_entry_id
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and exists (
        select 1
        from public.party_subledger_accounts psa
        where psa.account_id = jl.account_id
          and psa.is_active = true
      )
      and not exists (
        select 1
        from public.party_ledger_entries ple
        where ple.journal_line_id = jl.id
      )
      and public._resolve_party_for_entry(coalesce(je.source_table, ''), coalesce(je.source_id, '')) = p_party_id
    order by jl.journal_entry_id asc
    limit v_limit
  loop
    perform public.insert_party_ledger_for_entry(r.journal_entry_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.backfill_party_ledger_entries_for_party(uuid, integer) from public;
grant execute on function public.backfill_party_ledger_entries_for_party(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
