set app.allow_ledger_ddl = '1';

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
    return;
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

  if v_type = 'fx_revaluation' or v_type like 'smoke_fx_revaluation_%' then
    v_period_end := nullif(v_job.payload->>'periodEnd','')::date;
    if v_period_end is null then
      raise exception 'periodEnd required';
    end if;
    perform public.run_fx_revaluation(v_period_end);
  elsif v_type = 'auto_settlement' or v_type like 'smoke_auto_settlement_%' then
    v_party_id := nullif(v_job.payload->>'partyId','')::uuid;
    if v_party_id is null then
      raise exception 'partyId required';
    end if;
    perform public.auto_settle_party_items(v_party_id);
  elsif v_type = 'ledger_snapshot' or v_type like 'smoke_ledger_snapshot_%' then
    v_period_end := nullif(v_job.payload->>'asOf','')::date;
    if v_period_end is null then
      raise exception 'asOf required';
    end if;
    perform public.create_ledger_snapshot(v_period_end, null, null, 'job');
  elsif v_type = 'open_items_snapshot' or v_type like 'smoke_open_items_snapshot_%' then
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
    set status = case when attempts >= max_attempts then 'dead' else 'failed' end,
        finished_at = v_now,
        scheduled_at = case when attempts >= max_attempts then scheduled_at else v_scheduled_at end,
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
    return;
end;
$$;

notify pgrst, 'reload schema';

