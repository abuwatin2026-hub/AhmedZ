set app.allow_ledger_ddl = '1';

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
  v_now timestamptz := clock_timestamp();
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
      and a.due_at <= v_now
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

notify pgrst, 'reload schema';

