set app.allow_ledger_ddl = '1';

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

  if v_minutes is null and p_step ? 'timeoutMinutes' then
    begin
      v_minutes := nullif(p_step->>'timeoutMinutes','')::int;
    exception when others then
      v_minutes := null;
    end;
  end if;

  return v_minutes;
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
  if v_timeout is null then
    v_due := null;
  elsif v_timeout <= 0 then
    v_due := now();
  else
    v_due := now() + make_interval(mins => v_timeout);
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

notify pgrst, 'reload schema';

