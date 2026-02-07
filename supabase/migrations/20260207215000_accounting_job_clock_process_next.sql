set app.allow_ledger_ddl = '1';

create or replace function public.process_next_accounting_job(p_job_type text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select j.id into v_id
  from public.accounting_jobs j
  where j.status in ('queued','failed')
    and j.scheduled_at <= v_now
    and (p_job_type is null or lower(j.job_type) = lower(p_job_type))
  order by j.scheduled_at asc, j.created_at asc
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  perform public._run_accounting_job(v_id);
  return v_id;
end;
$$;

revoke all on function public.process_next_accounting_job(text) from public;
grant execute on function public.process_next_accounting_job(text) to authenticated;

notify pgrst, 'reload schema';

