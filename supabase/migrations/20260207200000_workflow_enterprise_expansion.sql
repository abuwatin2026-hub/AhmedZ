set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.workflow_event_logs') is null then
    create table public.workflow_event_logs (
      id uuid primary key default gen_random_uuid(),
      instance_id uuid not null references public.workflow_instances(id) on delete cascade,
      event_type text not null,
      actor_id uuid references auth.users(id) on delete set null,
      occurred_at timestamptz not null default now(),
      details jsonb not null default '{}'::jsonb
    );
    create index if not exists idx_workflow_event_logs_instance on public.workflow_event_logs(instance_id, occurred_at desc);
    create index if not exists idx_workflow_event_logs_type on public.workflow_event_logs(event_type, occurred_at desc);
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_step_assignments') is null then
    create table public.workflow_step_assignments (
      id uuid primary key default gen_random_uuid(),
      instance_id uuid not null references public.workflow_instances(id) on delete cascade,
      step_no int not null,
      assigned_permission text,
      assigned_to uuid references auth.users(id) on delete set null,
      due_at timestamptz,
      escalation_level int not null default 0,
      reason text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_workflow_step_assignments_instance_step on public.workflow_step_assignments(instance_id, step_no, created_at desc);
    create index if not exists idx_workflow_step_assignments_due on public.workflow_step_assignments(due_at) where due_at is not null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_delegations') is null then
    create table public.workflow_delegations (
      id uuid primary key default gen_random_uuid(),
      from_user_id uuid not null references auth.users(id) on delete cascade,
      to_user_id uuid not null references auth.users(id) on delete cascade,
      starts_at timestamptz not null default now(),
      ends_at timestamptz,
      is_active boolean not null default true,
      reason text,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(from_user_id, to_user_id, starts_at)
    );
    create index if not exists idx_workflow_delegations_from on public.workflow_delegations(from_user_id, is_active, starts_at desc);
    create index if not exists idx_workflow_delegations_to on public.workflow_delegations(to_user_id, is_active, starts_at desc);
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_escalation_rules') is null then
    create table public.workflow_escalation_rules (
      id uuid primary key default gen_random_uuid(),
      definition_id uuid not null references public.workflow_definitions(id) on delete cascade,
      step_no int not null,
      timeout_minutes int not null default 0,
      escalate_to_permission text,
      fallback_to_user_id uuid references auth.users(id) on delete set null,
      max_escalations int not null default 3,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(definition_id, step_no)
    );
    create index if not exists idx_workflow_escalation_rules_def on public.workflow_escalation_rules(definition_id, is_active);
  end if;
end $$;

alter table public.workflow_event_logs enable row level security;
alter table public.workflow_step_assignments enable row level security;
alter table public.workflow_delegations enable row level security;
alter table public.workflow_escalation_rules enable row level security;

drop policy if exists workflow_event_logs_select on public.workflow_event_logs;
create policy workflow_event_logs_select on public.workflow_event_logs
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_event_logs_insert_none on public.workflow_event_logs;
create policy workflow_event_logs_insert_none on public.workflow_event_logs
for insert with check (false);
drop policy if exists workflow_event_logs_update_none on public.workflow_event_logs;
create policy workflow_event_logs_update_none on public.workflow_event_logs
for update using (false);
drop policy if exists workflow_event_logs_delete_none on public.workflow_event_logs;
create policy workflow_event_logs_delete_none on public.workflow_event_logs
for delete using (false);

drop policy if exists workflow_step_assignments_select on public.workflow_step_assignments;
create policy workflow_step_assignments_select on public.workflow_step_assignments
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_step_assignments_insert_none on public.workflow_step_assignments;
create policy workflow_step_assignments_insert_none on public.workflow_step_assignments
for insert with check (false);
drop policy if exists workflow_step_assignments_update_none on public.workflow_step_assignments;
create policy workflow_step_assignments_update_none on public.workflow_step_assignments
for update using (false);
drop policy if exists workflow_step_assignments_delete_none on public.workflow_step_assignments;
create policy workflow_step_assignments_delete_none on public.workflow_step_assignments
for delete using (false);

drop policy if exists workflow_delegations_select on public.workflow_delegations;
create policy workflow_delegations_select on public.workflow_delegations
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_delegations_write on public.workflow_delegations;
create policy workflow_delegations_write on public.workflow_delegations
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists workflow_escalation_rules_select on public.workflow_escalation_rules;
create policy workflow_escalation_rules_select on public.workflow_escalation_rules
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_escalation_rules_write on public.workflow_escalation_rules;
create policy workflow_escalation_rules_write on public.workflow_escalation_rules
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public._workflow_log_event(p_instance_id uuid, p_event_type text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_instance_id is null then
    return;
  end if;
  insert into public.workflow_event_logs(instance_id, event_type, actor_id, occurred_at, details)
  values (p_instance_id, lower(nullif(btrim(coalesce(p_event_type,'')),'')), auth.uid(), now(), coalesce(p_details,'{}'::jsonb));
exception when others then
  null;
end;
$$;

revoke all on function public._workflow_log_event(uuid, text, jsonb) from public;
grant execute on function public._workflow_log_event(uuid, text, jsonb) to authenticated;

create or replace view public.workflow_current_assignments as
select distinct on (a.instance_id, a.step_no)
  a.id,
  a.instance_id,
  a.step_no,
  a.assigned_permission,
  a.assigned_to,
  a.due_at,
  a.escalation_level,
  a.reason,
  a.metadata,
  a.created_at,
  a.created_by
from public.workflow_step_assignments a
order by a.instance_id, a.step_no, a.created_at desc, a.id desc;

alter view public.workflow_current_assignments set (security_invoker = true);
grant select on public.workflow_current_assignments to authenticated;

create or replace function public._workflow_step_timeout_minutes(p_definition_id uuid, p_step_no int, p_step jsonb)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_minutes int;
begin
  v_minutes := null;
  if p_definition_id is not null then
    select r.timeout_minutes into v_minutes
    from public.workflow_escalation_rules r
    where r.definition_id = p_definition_id
      and r.step_no = p_step_no
      and r.is_active = true
    limit 1;
  end if;
  if v_minutes is null then
    begin
      v_minutes := nullif(p_step->>'timeoutMinutes','')::int;
    exception when others then
      v_minutes := null;
    end;
  end if;
  return coalesce(v_minutes, 0);
end;
$$;

revoke all on function public._workflow_step_timeout_minutes(uuid, int, jsonb) from public;
grant execute on function public._workflow_step_timeout_minutes(uuid, int, jsonb) to authenticated;

create or replace function public._workflow_insert_assignment(
  p_instance_id uuid,
  p_definition_id uuid,
  p_step_no int,
  p_step jsonb,
  p_escalation_level int default 0,
  p_reason text default null,
  p_override_permission text default null,
  p_override_assignee uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perm text;
  v_to uuid;
  v_timeout int;
  v_due timestamptz;
  v_id uuid;
begin
  if p_instance_id is null then
    return null;
  end if;
  v_perm := nullif(btrim(coalesce(p_override_permission, p_step->>'approverPermission','')), '');
  v_to := p_override_assignee;
  v_timeout := public._workflow_step_timeout_minutes(p_definition_id, p_step_no, p_step);
  if v_timeout > 0 then
    v_due := now() + make_interval(mins => v_timeout);
  else
    v_due := null;
  end if;

  insert into public.workflow_step_assignments(instance_id, step_no, assigned_permission, assigned_to, due_at, escalation_level, reason, metadata, created_by)
  values (p_instance_id, p_step_no, v_perm, v_to, v_due, greatest(coalesce(p_escalation_level,0),0), nullif(btrim(coalesce(p_reason,'')),''), jsonb_build_object('step',coalesce(p_step,'{}'::jsonb)), auth.uid())
  returning id into v_id;

  perform public._workflow_log_event(p_instance_id, 'assignment.created', jsonb_build_object('assignmentId', v_id::text, 'stepNo', p_step_no, 'permission', v_perm, 'assignedTo', coalesce(v_to::text,''), 'dueAt', coalesce(v_due::text,''), 'level', greatest(coalesce(p_escalation_level,0),0)));
  return v_id;
end;
$$;

revoke all on function public._workflow_insert_assignment(uuid, uuid, int, jsonb, int, text, text, uuid) from public;
grant execute on function public._workflow_insert_assignment(uuid, uuid, int, jsonb, int, text, text, uuid) to authenticated;

create or replace function public.start_workflow(
  p_module text,
  p_target_table text,
  p_target_id text,
  p_amount_base numeric,
  p_currency_code text default null,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def uuid;
  v_rule record;
  v_id uuid;
  v_step jsonb;
begin
  if not (public.has_admin_permission('accounting.manage') or public.has_admin_permission('accounting.approve')) then
    raise exception 'not allowed';
  end if;
  if p_module is null or btrim(p_module) = '' then
    raise exception 'module required';
  end if;
  if p_target_table is null or btrim(p_target_table) = '' then
    raise exception 'target_table required';
  end if;
  if p_target_id is null or btrim(p_target_id) = '' then
    raise exception 'target_id required';
  end if;

  select wd.id
  into v_def
  from public.workflow_definitions wd
  where wd.is_active = true
    and lower(wd.module) = lower(p_module)
  order by wd.created_at desc
  limit 1;

  if v_def is null then
    return null;
  end if;

  select wr.*
  into v_rule
  from public.workflow_rules wr
  where wr.definition_id = v_def
    and wr.is_active = true
    and public._match_workflow_rule(wr.conditions, coalesce(p_amount_base,0), p_company_id, p_branch_id, p_currency_code)
  order by wr.priority asc, wr.created_at asc
  limit 1;

  if not found then
    return null;
  end if;

  insert into public.workflow_instances(definition_id, rule_id, module, target_table, target_id, company_id, branch_id, amount_base, currency_code, status, current_step, created_by, metadata)
  values (v_def, v_rule.id, lower(p_module), lower(p_target_table), p_target_id, p_company_id, p_branch_id, coalesce(p_amount_base,0), upper(nullif(p_currency_code,'')), 'pending', 1, auth.uid(), coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;

  select value into v_step
  from jsonb_array_elements(coalesce(v_rule.steps,'[]'::jsonb))
  where (value->>'stepNo')::int = 1
  limit 1;

  if v_step is not null then
    perform public._workflow_insert_assignment(v_id, v_def, 1, v_step, 0, 'initial', null, null);
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'workflow.start',
    'workflow',
    v_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('instanceId', v_id::text, 'module', p_module, 'targetTable', p_target_table, 'targetId', p_target_id),
    'LOW',
    'WORKFLOW_START'
  );

  perform public._workflow_log_event(v_id, 'workflow.start', jsonb_build_object('module', p_module, 'targetTable', p_target_table, 'targetId', p_target_id));

  return v_id;
end;
$$;

revoke all on function public.start_workflow(text, text, text, numeric, text, uuid, uuid, jsonb) from public;
grant execute on function public.start_workflow(text, text, text, numeric, text, uuid, uuid, jsonb) to authenticated;

create or replace function public._workflow_is_delegated(p_from uuid, p_to uuid, p_at timestamptz default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.workflow_delegations d
    where d.is_active = true
      and d.from_user_id = p_from
      and d.to_user_id = p_to
      and d.starts_at <= coalesce(p_at, now())
      and (d.ends_at is null or d.ends_at >= coalesce(p_at, now()))
    limit 1
  );
$$;

revoke all on function public._workflow_is_delegated(uuid, uuid, timestamptz) from public;
grant execute on function public._workflow_is_delegated(uuid, uuid, timestamptz) to authenticated;

create or replace function public.decide_workflow(
  p_instance_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_rule public.workflow_rules%rowtype;
  v_steps jsonb;
  v_step jsonb;
  v_permission text;
  v_min int;
  v_mode text;
  v_approved_count int;
  v_assign public.workflow_current_assignments%rowtype;
  v_next_step jsonb;
begin
  if not (public.has_admin_permission('accounting.manage') or public.has_admin_permission('accounting.approve')) then
    raise exception 'not allowed';
  end if;

  if p_instance_id is null then
    raise exception 'instance_id required';
  end if;

  select * into v_inst
  from public.workflow_instances wi
  where wi.id = p_instance_id
  for update;

  if not found then
    raise exception 'workflow instance not found';
  end if;

  if v_inst.status <> 'pending' then
    return v_inst.status;
  end if;

  select * into v_rule
  from public.workflow_rules wr
  where wr.id = v_inst.rule_id;

  v_steps := coalesce(v_rule.steps, '[]'::jsonb);
  v_step := null;
  select value into v_step
  from jsonb_array_elements(v_steps)
  where (value->>'stepNo')::int = v_inst.current_step
  limit 1;

  if v_step is null then
    update public.workflow_instances
    set status = 'approved',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    perform public._workflow_log_event(v_inst.id, 'workflow.auto_approved', jsonb_build_object('reason','no_step'));
    return 'approved';
  end if;

  select * into v_assign
  from public.workflow_current_assignments a
  where a.instance_id = v_inst.id
    and a.step_no = v_inst.current_step
  order by a.created_at desc, a.id desc
  limit 1;

  v_permission := nullif(coalesce(v_assign.assigned_permission, v_step->>'approverPermission',''), '');
  if v_permission is not null then
    if v_assign.assigned_to is not null and v_assign.assigned_to <> auth.uid() then
      if public._workflow_is_delegated(v_assign.assigned_to, auth.uid(), now()) is not true then
        raise exception 'not allowed';
      end if;
    else
      if not public.has_admin_permission(v_permission) then
        raise exception 'missing permission %', v_permission;
      end if;
    end if;
  end if;

  if lower(coalesce(p_decision,'')) not in ('approved','rejected') then
    raise exception 'invalid decision';
  end if;

  insert into public.workflow_approvals(instance_id, step_no, decision, decided_by, note)
  values (v_inst.id, v_inst.current_step, lower(p_decision), auth.uid(), nullif(trim(coalesce(p_note,'')), ''))
  on conflict (instance_id, step_no, decided_by) do nothing;

  perform public._workflow_log_event(v_inst.id, concat('workflow.decision.', lower(p_decision)), jsonb_build_object('stepNo', v_inst.current_step, 'note', nullif(trim(coalesce(p_note,'')),'') ));

  if lower(p_decision) = 'rejected' then
    update public.workflow_instances
    set status = 'rejected',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values ('workflow.reject','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text),'MEDIUM','WORKFLOW_REJECT');
    return 'rejected';
  end if;

  v_mode := lower(coalesce(v_step->>'mode','serial'));
  v_min := coalesce(nullif(v_step->>'minApprovals','')::int, 1);

  select count(*) into v_approved_count
  from public.workflow_approvals wa
  where wa.instance_id = v_inst.id
    and wa.step_no = v_inst.current_step
    and wa.decision = 'approved';

  if v_mode = 'parallel' then
    if v_approved_count < greatest(v_min, 1) then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
      values ('workflow.approve_step_partial','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text,'step',v_inst.current_step,'approvedCount',v_approved_count),'LOW','WORKFLOW_STEP_PARTIAL');
      return 'pending';
    end if;
  end if;

  update public.workflow_instances
  set current_step = current_step + 1
  where id = v_inst.id;

  select * into v_inst from public.workflow_instances where id = p_instance_id;

  select value into v_next_step
  from jsonb_array_elements(v_steps)
  where (value->>'stepNo')::int = v_inst.current_step
  limit 1;

  if v_next_step is null then
    update public.workflow_instances
    set status = 'approved',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values ('workflow.approve','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text),'LOW','WORKFLOW_APPROVE');
    perform public._workflow_log_event(v_inst.id, 'workflow.approved', jsonb_build_object());
    return 'approved';
  end if;

  perform public._workflow_insert_assignment(v_inst.id, v_inst.definition_id, v_inst.current_step, v_next_step, 0, 'advance', null, null);
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('workflow.advance','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text,'step',v_inst.current_step),'LOW','WORKFLOW_ADVANCE');

  return 'pending';
end;
$$;

revoke all on function public.decide_workflow(uuid, text, text) from public;
grant execute on function public.decide_workflow(uuid, text, text) to authenticated;

create or replace function public.process_workflow_escalations(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int := 0;
  v_row record;
  v_step jsonb;
  v_rule public.workflow_rules%rowtype;
  v_inst public.workflow_instances%rowtype;
  v_escalation public.workflow_escalation_rules%rowtype;
  v_new_permission text;
  v_new_assignee uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  for v_row in
    select a.*
    from public.workflow_current_assignments a
    join public.workflow_instances wi on wi.id = a.instance_id
    where wi.status = 'pending'
      and a.due_at is not null
      and a.due_at <= now()
    order by a.due_at asc
    limit greatest(coalesce(p_limit, 200), 1)
  loop
    select * into v_inst from public.workflow_instances wi where wi.id = v_row.instance_id;
    select * into v_rule from public.workflow_rules wr where wr.id = v_inst.rule_id;
    select value into v_step
    from jsonb_array_elements(coalesce(v_rule.steps,'[]'::jsonb))
    where (value->>'stepNo')::int = v_row.step_no
    limit 1;

    select * into v_escalation
    from public.workflow_escalation_rules er
    where er.definition_id = v_inst.definition_id
      and er.step_no = v_row.step_no
      and er.is_active = true
    limit 1;

    v_new_permission := nullif(coalesce(v_escalation.escalate_to_permission, v_step->>'escalateToPermission',''), '');
    v_new_assignee := v_escalation.fallback_to_user_id;

    if v_new_permission is null then
      v_new_permission := 'accounting.manage';
    end if;

    if coalesce(v_row.escalation_level,0) >= coalesce(v_escalation.max_escalations, 3) then
      continue;
    end if;

    perform public._workflow_insert_assignment(
      v_row.instance_id,
      v_inst.definition_id,
      v_row.step_no,
      coalesce(v_step,'{}'::jsonb),
      coalesce(v_row.escalation_level,0) + 1,
      'timeout',
      v_new_permission,
      v_new_assignee
    );
    perform public._workflow_log_event(v_row.instance_id, 'workflow.escalated', jsonb_build_object('stepNo', v_row.step_no, 'fromPermission', v_row.assigned_permission, 'toPermission', v_new_permission, 'level', coalesce(v_row.escalation_level,0) + 1));
    v_cnt := v_cnt + 1;
  end loop;

  return v_cnt;
end;
$$;

revoke all on function public.process_workflow_escalations(int) from public;
grant execute on function public.process_workflow_escalations(int) to authenticated;

create or replace function public.simulate_workflow_path(
  p_document_type text,
  p_amount numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def public.workflow_definitions%rowtype;
  v_rule public.workflow_rules%rowtype;
  v_company uuid;
  v_branch uuid;
  v_currency text;
  v_steps jsonb;
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;
  v_company := nullif(p_metadata->>'companyId','')::uuid;
  v_branch := nullif(p_metadata->>'branchId','')::uuid;
  v_currency := upper(nullif(p_metadata->>'currencyCode',''));

  select * into v_def
  from public.workflow_definitions wd
  where wd.is_active = true
    and lower(wd.module) = lower(coalesce(p_document_type,''))
  order by wd.created_at desc
  limit 1;

  if v_def.id is null then
    return jsonb_build_object('matched', false, 'reason', 'no_definition');
  end if;

  select * into v_rule
  from public.workflow_rules wr
  where wr.definition_id = v_def.id
    and wr.is_active = true
    and public._match_workflow_rule(wr.conditions, coalesce(p_amount,0), v_company, v_branch, v_currency)
  order by wr.priority asc, wr.created_at asc
  limit 1;

  if v_rule.id is null then
    return jsonb_build_object('matched', false, 'definitionId', v_def.id::text, 'reason', 'no_rule');
  end if;

  v_steps := coalesce(v_rule.steps, '[]'::jsonb);

  return jsonb_build_object(
    'matched', true,
    'definitionId', v_def.id::text,
    'definitionName', v_def.name,
    'ruleId', v_rule.id::text,
    'priority', v_rule.priority,
    'steps', v_steps
  );
end;
$$;

revoke all on function public.simulate_workflow_path(text, numeric, jsonb) from public;
grant execute on function public.simulate_workflow_path(text, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
