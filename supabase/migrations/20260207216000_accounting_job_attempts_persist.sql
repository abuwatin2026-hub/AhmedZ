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
  v_started timestamptz;
  v_finished timestamptz;
  v_runtime_ms int;
  v_delay int;
  v_next timestamptz;
  v_attempt_no int;
  v_err text;
  v_sqlstate text;
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
    values (v_job.id, lower(v_job.job_type), v_job.payload, v_job.attempts, v_job.max_attempts, v_job.scheduled_at, clock_timestamp(), coalesce(v_job.last_error,'max attempts reached'))
    on conflict (job_id) do nothing;

    update public.accounting_jobs
    set status = 'dead',
        finished_at = clock_timestamp(),
        last_error = coalesce(last_error, 'max attempts reached')
    where id = v_job.id;
    return;
  end if;

  v_started := clock_timestamp();
  v_attempt_no := coalesce(v_job.attempts,0) + 1;

  update public.accounting_jobs
  set status = 'running',
      attempts = v_attempt_no,
      started_at = v_started,
      last_error = null
  where id = v_job.id;

  v_type := lower(v_job.job_type);
  v_err := null;
  v_sqlstate := null;

  begin
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
  exception
    when others then
      v_err := left(coalesce(sqlerrm,'error'), 2000);
      v_sqlstate := coalesce(sqlstate,'');
  end;

  v_finished := clock_timestamp();
  v_runtime_ms := (extract(epoch from (v_finished - v_started)) * 1000)::int;

  if v_err is null then
    update public.accounting_jobs
    set status = 'succeeded',
        finished_at = v_finished
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
    return;
  end if;

  v_delay := public._job_backoff_minutes(v_attempt_no);
  v_next := v_finished + make_interval(mins => v_delay);

  update public.accounting_jobs
  set status = case when v_attempt_no >= max_attempts then 'dead' else 'failed' end,
      finished_at = v_finished,
      scheduled_at = case when v_attempt_no >= max_attempts then scheduled_at else v_next end,
      last_error = v_err
  where id = v_job.id;

  insert into public.accounting_job_failures(job_id, job_type, attempt_no, occurred_at, error_message, error_detail, payload)
  values (
    v_job.id,
    lower(coalesce(v_job.job_type,'')),
    v_attempt_no,
    v_finished,
    v_err,
    jsonb_build_object('sqlstate', v_sqlstate, 'backoffMinutes', v_delay),
    coalesce(v_job.payload,'{}'::jsonb)
  );

  perform public._record_job_metric(lower(coalesce(v_job.job_type,'')), false, null);

  if v_attempt_no >= coalesce(v_job.max_attempts,5) then
    insert into public.accounting_job_dead_letters(job_id, job_type, payload, attempts, max_attempts, first_scheduled_at, dead_at, last_error)
    values (v_job.id, lower(coalesce(v_job.job_type,'')), coalesce(v_job.payload,'{}'::jsonb), v_attempt_no, coalesce(v_job.max_attempts,5), coalesce(v_job.scheduled_at, v_finished), v_finished, v_err)
    on conflict (job_id) do nothing;
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'accounting_jobs.failed',
    'accounting',
    v_job.id::text,
    auth.uid(),
    now(),
    jsonb_build_object('jobId', v_job.id::text, 'error', left(coalesce(v_err,'error'), 1000), 'backoffMinutes', v_delay),
    'MEDIUM',
    'JOB_FAILED'
  );
end;
$$;

notify pgrst, 'reload schema';

