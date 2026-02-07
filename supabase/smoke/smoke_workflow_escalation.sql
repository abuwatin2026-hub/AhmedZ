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
  perform set_config('app.smoke_owner_id', v_owner::text, false);

  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|WF00|Owner session ready|%|{}', ms;
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_def uuid;
  v_rule uuid;
  v_inst uuid;
  v_curr record;
  v_cnt int;
  v_sim jsonb;
  v_module text;
  v_target text;
begin
  t0 := clock_timestamp();

  v_module := concat('wf_escalation_smoke_', replace(gen_random_uuid()::text, '-', '')::text);
  v_target := concat('WF-ESC-', replace(gen_random_uuid()::text, '-', '')::text);

  insert into public.workflow_definitions(name, module, is_active, created_by)
  values ('WF Escalation Smoke', v_module, true, auth.uid())
  returning id into v_def;

  insert into public.workflow_rules(definition_id, priority, conditions, steps, is_active, created_by)
  values (
    v_def,
    1,
    '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('stepNo',1,'mode','serial','minApprovals',1,'approverPermission','accounting.manage')
    ),
    true,
    auth.uid()
  )
  returning id into v_rule;

  insert into public.workflow_escalation_rules(definition_id, step_no, timeout_minutes, escalate_to_permission, max_escalations, is_active, created_by)
  values (v_def, 1, 0, 'accounting.manage', 1, true, auth.uid())
  on conflict (definition_id, step_no) do update
  set timeout_minutes = excluded.timeout_minutes,
      escalate_to_permission = excluded.escalate_to_permission,
      max_escalations = excluded.max_escalations,
      is_active = true;

  v_inst := public.start_workflow(v_module, 'smoke_table', v_target, 100, public.get_base_currency(), public.get_default_company_id(), public.get_default_branch_id(), jsonb_build_object('smoke',true));
  if v_inst is null then
    raise exception 'workflow instance not created';
  end if;

  select * into v_curr
  from public.workflow_current_assignments a
  where a.instance_id = v_inst and a.step_no = 1;
  if v_curr.id is null then
    raise exception 'missing current assignment';
  end if;
  if v_curr.due_at is null then
    raise exception 'expected due_at set (timeout semantics)';
  end if;

  select public.process_workflow_escalations(50) into v_cnt;
  if coalesce(v_cnt,0) < 1 then
    raise exception 'expected escalation processed';
  end if;

  select * into v_curr
  from public.workflow_current_assignments a
  where a.instance_id = v_inst and a.step_no = 1;
  if coalesce(v_curr.escalation_level,0) <> 1 then
    raise exception 'expected escalation_level=1, got %', coalesce(v_curr.escalation_level,0);
  end if;

  if not exists (select 1 from public.workflow_event_logs l where l.instance_id = v_inst and l.event_type = 'workflow.escalated') then
    raise exception 'missing workflow.escalated event log';
  end if;

  v_sim := public.simulate_workflow_path(v_module, 100, jsonb_build_object('companyId', public.get_default_company_id()::text, 'branchId', public.get_default_branch_id()::text, 'currencyCode', public.get_base_currency()));
  if coalesce(v_sim->>'matched','false') <> 'true' then
    raise exception 'simulate_workflow_path expected matched=true';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|WF10|Workflow escalation, logs, simulation work|%|{"instanceId":"%"}', ms, v_inst::text;
end $$;

do $$
begin
  raise notice 'WORKFLOW_ESCALATION_SMOKE_OK';
end $$;
