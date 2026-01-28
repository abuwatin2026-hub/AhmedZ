create or replace function public.list_approval_requests(
  p_status text default 'pending',
  p_limit int default 200
)
returns table (
  id uuid,
  target_table text,
  target_id text,
  request_type text,
  status text,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_limit int;
begin
  perform public._require_staff('list_approval_requests');
  v_status := nullif(trim(coalesce(p_status, '')), '');
  v_limit := coalesce(p_limit, 200);
  if v_limit < 1 then v_limit := 1; end if;
  if v_limit > 500 then v_limit := 500; end if;

  if v_status is null or v_status = 'all' then
    return query
    select
      ar.id,
      ar.target_table,
      ar.target_id,
      ar.request_type,
      ar.status,
      ar.requested_by,
      ar.approved_by,
      ar.approved_at,
      ar.rejected_by,
      ar.rejected_at,
      ar.created_at
    from public.approval_requests ar
    order by ar.created_at desc nulls last
    limit v_limit;
  end if;

  if v_status not in ('pending','approved','rejected') then
    raise exception 'invalid status';
  end if;

  return query
  select
    ar.id,
    ar.target_table,
    ar.target_id,
    ar.request_type,
    ar.status,
    ar.requested_by,
    ar.approved_by,
    ar.approved_at,
    ar.rejected_by,
    ar.rejected_at,
    ar.created_at
  from public.approval_requests ar
  where ar.status = v_status
  order by ar.created_at desc nulls last
  limit v_limit;
end;
$$;

revoke all on function public.list_approval_requests(text, int) from public;
grant execute on function public.list_approval_requests(text, int) to authenticated;

create or replace function public.list_approval_steps(p_request_ids uuid[])
returns table (
  id uuid,
  request_id uuid,
  step_no int,
  approver_role text,
  status text,
  action_by uuid,
  action_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_staff('list_approval_steps');
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;
  return query
  select
    s.id,
    s.request_id,
    s.step_no,
    s.approver_role,
    s.status,
    s.action_by,
    s.action_at
  from public.approval_steps s
  where s.request_id = any(p_request_ids)
  order by s.request_id asc, s.step_no asc;
end;
$$;

revoke all on function public.list_approval_steps(uuid[]) from public;
grant execute on function public.list_approval_steps(uuid[]) to authenticated;
