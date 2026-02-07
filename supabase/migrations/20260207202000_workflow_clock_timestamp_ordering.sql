set app.allow_ledger_ddl = '1';

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
  values (p_instance_id, lower(nullif(btrim(coalesce(p_event_type,'')),'')), auth.uid(), clock_timestamp(), coalesce(p_details,'{}'::jsonb));
exception when others then
  null;
end;
$$;

revoke all on function public._workflow_log_event(uuid, text, jsonb) from public;
grant execute on function public._workflow_log_event(uuid, text, jsonb) to authenticated;

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
  v_now timestamptz := clock_timestamp();
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
    v_due := v_now;
  else
    v_due := v_now + make_interval(mins => v_timeout);
  end if;

  insert into public.workflow_step_assignments(instance_id, step_no, assigned_permission, assigned_to, due_at, escalation_level, reason, metadata, created_at, created_by)
  values (
    p_instance_id,
    p_step_no,
    v_perm,
    v_to,
    v_due,
    greatest(coalesce(p_escalation_level,0),0),
    nullif(btrim(coalesce(p_reason,'')), ''),
    jsonb_build_object('step',coalesce(p_step,'{}'::jsonb)),
    v_now,
    auth.uid()
  )
  returning id into v_id;

  perform public._workflow_log_event(p_instance_id, 'assignment.created', jsonb_build_object('assignmentId', v_id::text, 'stepNo', p_step_no, 'permission', v_perm, 'assignedTo', coalesce(v_to::text,''), 'dueAt', coalesce(v_due::text,''), 'level', greatest(coalesce(p_escalation_level,0),0)));
  return v_id;
end;
$$;

revoke all on function public._workflow_insert_assignment(uuid, uuid, int, jsonb, int, text, text, uuid) from public;
grant execute on function public._workflow_insert_assignment(uuid, uuid, int, jsonb, int, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

