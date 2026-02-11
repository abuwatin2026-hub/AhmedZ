create or replace function public.create_approval_request(
  p_target_table text,
  p_target_id text,
  p_request_type text,
  p_amount numeric,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request_id uuid;
  v_policy_id uuid;
  v_payload_hash text;
begin
  if not public.approval_required(p_request_type, p_amount) then
    raise exception 'approval policy not found for request_type %', p_request_type;
  end if;

  v_payload_hash := encode(digest(convert_to(coalesce(p_payload::text, ''), 'utf8'), 'sha256'::text), 'hex');

  insert into public.approval_requests(
    target_table, target_id, request_type, status, requested_by, payload_hash
  )
  values (
    p_target_table, p_target_id, p_request_type, 'pending', auth.uid(), v_payload_hash
  )
  on conflict (target_table, target_id, request_type)
  do update set
    payload_hash = excluded.payload_hash
  where approval_requests.status = 'pending'
  returning id into v_request_id;

  select p.id into v_policy_id
  from public.approval_policies p
  where p.request_type = p_request_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0))
  order by p.min_amount desc
  limit 1;

  insert into public.approval_steps(request_id, step_no, approver_role, status)
  select v_request_id, s.step_no, s.approver_role, 'pending'
  from public.approval_policy_steps s
  where s.policy_id = v_policy_id
  order by s.step_no asc
  on conflict (request_id, step_no) do nothing;

  return v_request_id;
end;
$$;

revoke all on function public.create_approval_request(text, text, text, numeric, jsonb) from public;
grant execute on function public.create_approval_request(text, text, text, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
