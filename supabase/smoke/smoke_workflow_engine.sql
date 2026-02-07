set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  v_owner uuid;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;
  perform set_config('app.smoke_owner_id', v_owner::text, false);
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner_id text;
  v_owner uuid;
  v_exists int;
begin
  t0 := clock_timestamp();
  v_owner_id := nullif(current_setting('app.smoke_owner_id', true), '');
  v_owner := nullif(v_owner_id,'')::uuid;

  if v_owner is null then
    raise exception 'missing owner id in config';
  end if;

  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
  set role authenticated;

  if to_regclass('public.workflow_definitions') is null then
    raise exception 'workflow_definitions missing';
  end if;
  if to_regclass('public.workflow_rules') is null then
    raise exception 'workflow_rules missing';
  end if;
  if to_regclass('public.workflow_instances') is null then
    raise exception 'workflow_instances missing';
  end if;
  if to_regclass('public.workflow_approvals') is null then
    raise exception 'workflow_approvals missing';
  end if;

  if not exists (select 1 from pg_proc where proname = 'start_workflow') then
    raise exception 'start_workflow missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'decide_workflow') then
    raise exception 'decide_workflow missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'get_workflow_status') then
    raise exception 'get_workflow_status missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|WF00|Workflow engine core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_def uuid;
  v_rule uuid;
  v_inst uuid;
  v_status text;
  v_cnt int;
  v_module text;
  v_target_1 text;
  v_target_2 text;
begin
  t0 := clock_timestamp();

  v_module := concat('smoke_module_', replace(gen_random_uuid()::text, '-', '')::text);
  v_target_1 := concat('WF-1-', replace(gen_random_uuid()::text, '-', '')::text);
  v_target_2 := concat('WF-2-', replace(gen_random_uuid()::text, '-', '')::text);

  insert into public.workflow_definitions(name, module, is_active, created_by)
  values ('Smoke Workflow', v_module, true, auth.uid())
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

  v_inst := public.start_workflow(v_module, 'smoke_table', v_target_1, 100, public.get_base_currency(), public.get_default_company_id(), public.get_default_branch_id(), jsonb_build_object('smoke',true));
  if v_inst is null then
    raise exception 'expected workflow instance id';
  end if;

  select status into v_status from public.workflow_instances where id = v_inst;
  if v_status is distinct from 'pending' then
    raise exception 'expected pending status, got %', v_status;
  end if;

  v_status := public.decide_workflow(v_inst, 'approved', 'smoke approve');
  if v_status is distinct from 'approved' then
    raise exception 'expected approved decision result, got %', v_status;
  end if;

  select count(*) into v_cnt from public.workflow_approvals where instance_id = v_inst and decision = 'approved';
  if v_cnt < 1 then
    raise exception 'expected approval rows';
  end if;

  v_inst := public.start_workflow(v_module, 'smoke_table', v_target_2, 50, public.get_base_currency(), public.get_default_company_id(), public.get_default_branch_id(), jsonb_build_object('smoke',true));
  if v_inst is null then
    raise exception 'expected workflow instance id (WF-2)';
  end if;

  v_status := public.decide_workflow(v_inst, 'rejected', 'smoke reject');
  if v_status is distinct from 'rejected' then
    raise exception 'expected rejected decision result, got %', v_status;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|WF01|Start/approve/reject workflows works|%|{}', ms;
end $$;

do $$
begin
  raise notice 'WORKFLOW_SMOKE_OK';
end $$;
