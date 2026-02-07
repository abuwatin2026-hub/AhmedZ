set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.accounting_job_failures') is null then
    create table public.accounting_job_failures (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references public.accounting_jobs(id) on delete cascade,
      job_type text not null,
      attempt_no int not null,
      occurred_at timestamptz not null default now(),
      error_message text,
      error_detail jsonb not null default '{}'::jsonb,
      payload jsonb not null default '{}'::jsonb
    );
    create index if not exists idx_accounting_job_failures_job on public.accounting_job_failures(job_id, occurred_at desc);
    create index if not exists idx_accounting_job_failures_type on public.accounting_job_failures(job_type, occurred_at desc);
  end if;
end $$;

do $$
begin
  if to_regclass('public.accounting_job_metrics') is null then
    create table public.accounting_job_metrics (
      id uuid primary key default gen_random_uuid(),
      metric_date date not null,
      job_type text not null,
      succeeded_count int not null default 0,
      failed_count int not null default 0,
      avg_runtime_ms numeric,
      updated_at timestamptz not null default now(),
      unique(metric_date, job_type)
    );
    create index if not exists idx_accounting_job_metrics_date on public.accounting_job_metrics(metric_date desc, job_type);
  end if;
end $$;

do $$
begin
  if to_regclass('public.accounting_job_dead_letters') is null then
    create table public.accounting_job_dead_letters (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null unique,
      job_type text not null,
      payload jsonb not null default '{}'::jsonb,
      attempts int not null,
      max_attempts int not null,
      first_scheduled_at timestamptz not null,
      dead_at timestamptz not null default now(),
      last_error text
    );
    create index if not exists idx_accounting_job_dead_letters_type on public.accounting_job_dead_letters(job_type, dead_at desc);
  end if;
end $$;

do $$
begin
  if to_regclass('public.accounting_job_schedules') is null then
    create table public.accounting_job_schedules (
      id uuid primary key default gen_random_uuid(),
      job_type text not null,
      payload jsonb not null default '{}'::jsonb,
      every_minutes int not null default 1440,
      next_run_at timestamptz not null default now(),
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(job_type)
    );
    create index if not exists idx_accounting_job_schedules_next on public.accounting_job_schedules(is_active, next_run_at asc);
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'accounting_jobs_status_check') then
    alter table public.accounting_jobs drop constraint accounting_jobs_status_check;
  end if;
  alter table public.accounting_jobs
    add constraint accounting_jobs_status_check check (status in ('queued','running','succeeded','failed','cancelled','dead'));
exception when others then
  null;
end $$;

alter table public.accounting_job_failures enable row level security;
alter table public.accounting_job_metrics enable row level security;
alter table public.accounting_job_dead_letters enable row level security;
alter table public.accounting_job_schedules enable row level security;

drop policy if exists accounting_job_failures_select on public.accounting_job_failures;
create policy accounting_job_failures_select on public.accounting_job_failures
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_job_failures_write on public.accounting_job_failures;
create policy accounting_job_failures_write on public.accounting_job_failures
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists accounting_job_metrics_select on public.accounting_job_metrics;
create policy accounting_job_metrics_select on public.accounting_job_metrics
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_job_metrics_write on public.accounting_job_metrics;
create policy accounting_job_metrics_write on public.accounting_job_metrics
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists accounting_job_dead_letters_select on public.accounting_job_dead_letters;
create policy accounting_job_dead_letters_select on public.accounting_job_dead_letters
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_job_dead_letters_write on public.accounting_job_dead_letters;
create policy accounting_job_dead_letters_write on public.accounting_job_dead_letters
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists accounting_job_schedules_select on public.accounting_job_schedules;
create policy accounting_job_schedules_select on public.accounting_job_schedules
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_job_schedules_write on public.accounting_job_schedules;
create policy accounting_job_schedules_write on public.accounting_job_schedules
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public._job_backoff_minutes(p_attempts int)
returns int
language plpgsql
immutable
as $$
declare
  v int;
begin
  v := greatest(coalesce(p_attempts, 0), 0);
  if v <= 1 then
    return 1;
  end if;
  return least(1440, (2 ^ (v - 1))::int);
end;
$$;

revoke all on function public._job_backoff_minutes(int) from public;
grant execute on function public._job_backoff_minutes(int) to authenticated;

create or replace function public._record_job_metric(p_job_type text, p_succeeded boolean, p_runtime_ms int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := current_date;
  v_type text := lower(coalesce(p_job_type,''));
  v_prev_avg numeric;
  v_prev_cnt int;
  v_new_avg numeric;
begin
  if v_type = '' then
    return;
  end if;

  select coalesce(succeeded_count,0) + coalesce(failed_count,0), avg_runtime_ms
  into v_prev_cnt, v_prev_avg
  from public.accounting_job_metrics m
  where m.metric_date = v_date and m.job_type = v_type;

  if v_prev_cnt is null then
    v_prev_cnt := 0;
    v_prev_avg := null;
  end if;

  if p_runtime_ms is not null and p_runtime_ms >= 0 then
    if v_prev_cnt = 0 or v_prev_avg is null then
      v_new_avg := p_runtime_ms;
    else
      v_new_avg := ((v_prev_avg * v_prev_cnt) + p_runtime_ms) / (v_prev_cnt + 1);
    end if;
  else
    v_new_avg := v_prev_avg;
  end if;

  insert into public.accounting_job_metrics(metric_date, job_type, succeeded_count, failed_count, avg_runtime_ms, updated_at)
  values (v_date, v_type, case when p_succeeded then 1 else 0 end, case when p_succeeded then 0 else 1 end, v_new_avg, now())
  on conflict (metric_date, job_type)
  do update set
    succeeded_count = public.accounting_job_metrics.succeeded_count + case when p_succeeded then 1 else 0 end,
    failed_count = public.accounting_job_metrics.failed_count + case when p_succeeded then 0 else 1 end,
    avg_runtime_ms = v_new_avg,
    updated_at = now();
exception when others then
  null;
end;
$$;

revoke all on function public._record_job_metric(text, boolean, int) from public;
grant execute on function public._record_job_metric(text, boolean, int) to authenticated;

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
  v_now timestamptz := clock_timestamp();
  v_started timestamptz;
  v_runtime_ms int;
  v_delay int;
  v_scheduled_at timestamptz;
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
    insert into public.accounting_job_dead_letters(job_id, job_type, payload, attempts, max_attempts, first_scheduled_at, dead_at, last_error)
    values (v_job.id, lower(v_job.job_type), v_job.payload, v_job.attempts, v_job.max_attempts, v_job.scheduled_at, v_now, coalesce(v_job.last_error,'max attempts reached'))
    on conflict (job_id) do nothing;

    update public.accounting_jobs
    set status = 'dead',
        finished_at = v_now,
        last_error = coalesce(last_error, 'max attempts reached')
    where id = v_job.id;
    return;
  end if;

  v_started := v_now;

  update public.accounting_jobs
  set status = 'running',
      attempts = attempts + 1,
      started_at = v_started,
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

  v_now := clock_timestamp();
  v_runtime_ms := (extract(epoch from (v_now - v_started)) * 1000)::int;

  update public.accounting_jobs
  set status = 'succeeded',
      finished_at = v_now
  where id = v_job.id;

  perform public._record_job_metric(v_type, true, v_runtime_ms);

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'accounting_jobs.succeeded',
    'accounting',
    v_job.id::text,
    auth.uid(),
    now(),
    jsonb_build_object('jobId', v_job.id::text, 'jobType', v_type, 'runtimeMs', v_runtime_ms),
    'LOW',
    'JOB_SUCCEEDED'
  );
exception
  when others then
    v_now := clock_timestamp();
    v_delay := public._job_backoff_minutes(coalesce(v_job.attempts,0) + 1);
    v_scheduled_at := v_now + make_interval(mins => v_delay);

    update public.accounting_jobs
    set status = case when (attempts + 1) >= max_attempts then 'dead' else 'failed' end,
        finished_at = v_now,
        scheduled_at = case when (attempts + 1) >= max_attempts then scheduled_at else v_scheduled_at end,
        last_error = left(coalesce(sqlerrm,'error'), 2000)
    where id = p_job_id;

    insert into public.accounting_job_failures(job_id, job_type, attempt_no, occurred_at, error_message, error_detail, payload)
    values (
      p_job_id,
      lower(coalesce(v_job.job_type,'')),
      coalesce(v_job.attempts,0) + 1,
      v_now,
      left(coalesce(sqlerrm,'error'), 2000),
      jsonb_build_object('sqlstate', coalesce(sqlstate,''), 'backoffMinutes', v_delay),
      coalesce(v_job.payload,'{}'::jsonb)
    );

    perform public._record_job_metric(lower(coalesce(v_job.job_type,'')), false, null);

    if (coalesce(v_job.attempts,0) + 1) >= coalesce(v_job.max_attempts,5) then
      insert into public.accounting_job_dead_letters(job_id, job_type, payload, attempts, max_attempts, first_scheduled_at, dead_at, last_error)
      values (p_job_id, lower(coalesce(v_job.job_type,'')), coalesce(v_job.payload,'{}'::jsonb), coalesce(v_job.attempts,0) + 1, coalesce(v_job.max_attempts,5), coalesce(v_job.scheduled_at, v_now), v_now, left(coalesce(sqlerrm,'error'),2000))
      on conflict (job_id) do nothing;
    end if;

    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values (
      'accounting_jobs.failed',
      'accounting',
      p_job_id::text,
      auth.uid(),
      now(),
      jsonb_build_object('jobId', p_job_id::text, 'error', left(coalesce(sqlerrm,'error'), 1000), 'backoffMinutes', v_delay),
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

create or replace function public.process_accounting_jobs(p_limit int default 50, p_job_type text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  loop
    exit when v_n >= greatest(coalesce(p_limit,50),1);
    begin
      v_id := public.process_next_accounting_job(p_job_type);
      if v_id is null then
        exit;
      end if;
      v_n := v_n + 1;
    exception when others then
      v_n := v_n + 1;
    end;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.process_accounting_jobs(int, text) from public;
grant execute on function public.process_accounting_jobs(int, text) to authenticated;

create or replace function public.run_accounting_scheduler(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_row record;
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  for v_row in
    select *
    from public.accounting_job_schedules s
    where s.is_active = true
      and s.next_run_at <= v_now
    order by s.next_run_at asc
    limit greatest(coalesce(p_limit,50),1)
    for update skip locked
  loop
    perform public.enqueue_accounting_job(v_row.job_type, v_row.payload, v_now);
    v_next := v_row.next_run_at + make_interval(mins => greatest(v_row.every_minutes,1));
    update public.accounting_job_schedules
    set next_run_at = v_next
    where id = v_row.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.run_accounting_scheduler(int) from public;
grant execute on function public.run_accounting_scheduler(int) to authenticated;

notify pgrst, 'reload schema';

