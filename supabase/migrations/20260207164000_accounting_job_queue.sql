set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.accounting_jobs') is null then
    create table public.accounting_jobs (
      id uuid primary key default gen_random_uuid(),
      job_type text not null,
      status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
      payload jsonb not null default '{}'::jsonb,
      attempts int not null default 0,
      max_attempts int not null default 5,
      scheduled_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_accounting_jobs_queue on public.accounting_jobs(status, scheduled_at asc, created_at asc);
    create index if not exists idx_accounting_jobs_type on public.accounting_jobs(job_type, status);
  end if;
end $$;

alter table public.accounting_jobs enable row level security;
drop policy if exists accounting_jobs_select on public.accounting_jobs;
create policy accounting_jobs_select on public.accounting_jobs
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_jobs_insert on public.accounting_jobs;
create policy accounting_jobs_insert on public.accounting_jobs
for insert with check (public.has_admin_permission('accounting.manage'));
drop policy if exists accounting_jobs_update on public.accounting_jobs;
create policy accounting_jobs_update on public.accounting_jobs
for update using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists accounting_jobs_delete_none on public.accounting_jobs;
create policy accounting_jobs_delete_none on public.accounting_jobs
for delete using (false);

create or replace function public.enqueue_accounting_job(p_job_type text, p_payload jsonb default '{}'::jsonb, p_scheduled_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_job_type is null or btrim(p_job_type) = '' then
    raise exception 'job_type required';
  end if;
  insert into public.accounting_jobs(job_type, status, payload, scheduled_at, created_by)
  values (lower(p_job_type), 'queued', coalesce(p_payload,'{}'::jsonb), coalesce(p_scheduled_at, now()), auth.uid())
  returning id into v_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'accounting_jobs.enqueue',
    'accounting',
    v_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('jobId', v_id::text, 'jobType', lower(p_job_type)),
    'LOW',
    'JOB_ENQUEUE'
  );

  return v_id;
end;
$$;

revoke all on function public.enqueue_accounting_job(text, jsonb, timestamptz) from public;
grant execute on function public.enqueue_accounting_job(text, jsonb, timestamptz) to authenticated;

create or replace function public._run_accounting_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.accounting_jobs%rowtype;
  v_type text;
  v_period_end date;
  v_party_id uuid;
begin
  select * into v_job
  from public.accounting_jobs j
  where j.id = p_job_id
  for update;
  if not found then
    raise exception 'job not found';
  end if;
  if v_job.status not in ('queued','failed') then
    return;
  end if;
  if v_job.attempts >= v_job.max_attempts then
    update public.accounting_jobs
    set status = 'failed',
        finished_at = now(),
        last_error = coalesce(last_error, 'max attempts reached')
    where id = v_job.id;
    return;
  end if;

  update public.accounting_jobs
  set status = 'running',
      attempts = attempts + 1,
      started_at = now(),
      last_error = null
  where id = v_job.id;

  v_type := lower(v_job.job_type);

  if v_type = 'fx_revaluation' then
    v_period_end := nullif(v_job.payload->>'periodEnd','')::date;
    if v_period_end is null then
      raise exception 'periodEnd required';
    end if;
    perform public.run_fx_revaluation(v_period_end);
  elsif v_type = 'auto_settlement' then
    v_party_id := nullif(v_job.payload->>'partyId','')::uuid;
    if v_party_id is null then
      raise exception 'partyId required';
    end if;
    perform public.auto_settle_party_items(v_party_id);
  elsif v_type = 'ledger_snapshot' then
    v_period_end := nullif(v_job.payload->>'asOf','')::date;
    if v_period_end is null then
      raise exception 'asOf required';
    end if;
    perform public.create_ledger_snapshot(v_period_end, null, null, 'job');
  elsif v_type = 'open_items_snapshot' then
    v_period_end := nullif(v_job.payload->>'asOf','')::date;
    if v_period_end is null then
      raise exception 'asOf required';
    end if;
    perform public.create_party_open_items_snapshot(v_period_end, null, null, 'job');
  else
    perform 1;
  end if;

  update public.accounting_jobs
  set status = 'succeeded',
      finished_at = now()
  where id = v_job.id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'accounting_jobs.succeeded',
    'accounting',
    v_job.id::text,
    auth.uid(),
    now(),
    jsonb_build_object('jobId', v_job.id::text, 'jobType', v_type),
    'LOW',
    'JOB_SUCCEEDED'
  );
exception
  when others then
    update public.accounting_jobs
    set status = 'failed',
        finished_at = now(),
        last_error = left(coalesce(sqlerrm,'error'), 2000)
    where id = p_job_id;
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values (
      'accounting_jobs.failed',
      'accounting',
      p_job_id::text,
      auth.uid(),
      now(),
      jsonb_build_object('jobId', p_job_id::text, 'error', left(coalesce(sqlerrm,'error'), 1000)),
      'MEDIUM',
      'JOB_FAILED'
    );
    raise;
end;
$$;

create or replace function public.process_next_accounting_job(p_job_type text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select j.id into v_id
  from public.accounting_jobs j
  where j.status in ('queued','failed')
    and j.scheduled_at <= now()
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

