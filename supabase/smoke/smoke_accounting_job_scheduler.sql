set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner uuid;
  v_exists int;
begin
  t0 := clock_timestamp();
  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;

  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|JQ00|Owner session ready|%|{}', ms;
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_job uuid;
  v_fail uuid;
  v_cnt int;
  v_sched uuid;
  v_status text;
  v_attempts int;
  v_job_type text;
  v_fail_cnt int;
begin
  t0 := clock_timestamp();

  v_job_type := concat('smoke_fx_revaluation_', replace(gen_random_uuid()::text, '-', '')::text);

  insert into public.accounting_job_schedules(job_type, payload, every_minutes, next_run_at, is_active, created_by)
  values (v_job_type, '{}'::jsonb, 1, clock_timestamp(), true, auth.uid())
  on conflict (job_type) do update
  set payload = excluded.payload, every_minutes = excluded.every_minutes, next_run_at = excluded.next_run_at, is_active = true;

  select public.run_accounting_scheduler(10) into v_cnt;
  if coalesce(v_cnt,0) < 1 then
    raise exception 'expected scheduler to enqueue jobs';
  end if;

  select id into v_job
  from public.accounting_jobs
  where job_type = v_job_type
  order by created_at desc
  limit 1;
  if v_job is null then
    raise exception 'expected scheduled job row';
  end if;

  update public.accounting_jobs
  set max_attempts = 2
  where id = v_job;

  begin
    perform public.process_next_accounting_job(v_job_type);
  exception when others then
    null;
  end;

  select status, attempts into v_status, v_attempts
  from public.accounting_jobs
  where id = v_job;
  select count(*) into v_fail_cnt
  from public.accounting_job_failures f
  where f.job_id = v_job;
  raise notice 'SMOKE_INFO|JQ11|After first run|0|{"status":"%","attempts":%,"failures":%}', v_status, coalesce(v_attempts,0), coalesce(v_fail_cnt,0);

  update public.accounting_jobs
  set scheduled_at = clock_timestamp()
  where id = v_job and status = 'failed';

  begin
    perform public.process_next_accounting_job(v_job_type);
  exception when others then
    null;
  end;

  select status, attempts into v_status, v_attempts
  from public.accounting_jobs
  where id = v_job;
  select count(*) into v_fail_cnt
  from public.accounting_job_failures f
  where f.job_id = v_job;
  raise notice 'SMOKE_INFO|JQ12|After second run|0|{"status":"%","attempts":%,"failures":%}', v_status, coalesce(v_attempts,0), coalesce(v_fail_cnt,0);

  if not exists (select 1 from public.accounting_job_failures f where f.job_id = v_job) then
    raise exception 'expected failure rows';
  end if;
  if not exists (select 1 from public.accounting_job_dead_letters d where d.job_id = v_job) then
    raise exception 'expected dead letter row';
  end if;
  if coalesce(v_attempts,0) < 2 then
    raise exception 'expected attempts >= 2';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|JQ10|Scheduler/backoff/DLQ tables work|%|{"jobId":"%"}', ms, v_job::text;
end $$;

do $$
begin
  raise notice 'JOB_QUEUE_SCHEDULER_SMOKE_OK';
end $$;
