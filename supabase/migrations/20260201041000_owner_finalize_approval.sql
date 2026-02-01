create or replace function public.owner_finalize_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  if not public.is_owner() then
    raise exception 'not authorized';
  end if;
  select *
  into v_req
  from public.approval_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'approval request not found';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;
  update public.approval_steps
  set status = 'approved',
      action_by = auth.uid(),
      action_at = now()
  where request_id = p_request_id
    and status = 'pending';
  update public.approval_requests
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_request_id
    and status = 'pending';
end;
$$;

revoke all on function public.owner_finalize_approval_request(uuid) from public;
grant execute on function public.owner_finalize_approval_request(uuid) to authenticated;
