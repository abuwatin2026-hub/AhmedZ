create or replace function public.approve_approval_step(p_request_id uuid, p_step_no int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_by uuid;
  v_required_role text;
  v_actor_role text;
  v_remaining int;
begin
  select ar.requested_by
  into v_requested_by
  from public.approval_requests ar
  where ar.id = p_request_id;

  if v_requested_by is null then
    raise exception 'approval request not found';
  end if;

  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_requested_by = auth.uid() then
    raise exception 'self_approval_forbidden';
  end if;

  select s.approver_role
  into v_required_role
  from public.approval_steps s
  where s.request_id = p_request_id
    and s.step_no = p_step_no;

  if v_required_role is null then
    raise exception 'approval step not found';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true
  limit 1;

  if v_actor_role is null then
    raise exception 'not authorized';
  end if;

  if v_actor_role <> v_required_role and v_actor_role <> 'owner' then
    raise exception 'not authorized';
  end if;

  update public.approval_steps
  set status = 'approved', action_by = auth.uid(), action_at = now()
  where request_id = p_request_id
    and step_no = p_step_no
    and status = 'pending';

  if not found then
    raise exception 'approval step not pending';
  end if;

  select count(*)
  into v_remaining
  from public.approval_steps
  where request_id = p_request_id and status <> 'approved';

  if v_remaining = 0 then
    update public.approval_requests
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_request_id;
  end if;
end;
$$;

create or replace function public.trg_lock_approval_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval request is immutable';
  end if;

  if new.id <> old.id
     or new.target_table <> old.target_table
     or new.target_id <> old.target_id
     or new.request_type <> old.request_type
     or new.requested_by <> old.requested_by
     or new.payload_hash <> old.payload_hash
     or new.created_at <> old.created_at then
    raise exception 'approval request is immutable';
  end if;

  if old.status <> 'pending' then
    raise exception 'approval request already finalized';
  end if;

  if new.status = 'pending' then
    if new.approved_by is not null or new.approved_at is not null or new.rejected_by is not null or new.rejected_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  if new.status = 'approved' then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'approval request missing approved_by/approved_at';
    end if;
    if new.rejected_by is not null or new.rejected_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  if new.status = 'rejected' then
    if new.rejected_by is null or new.rejected_at is null then
      raise exception 'approval request missing rejected_by/rejected_at';
    end if;
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lock_approval_requests on public.approval_requests;
create trigger trg_lock_approval_requests
before update or delete on public.approval_requests
for each row execute function public.trg_lock_approval_requests();

create or replace function public.trg_lock_approval_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval step is immutable';
  end if;

  if new.id <> old.id
     or new.request_id <> old.request_id
     or new.step_no <> old.step_no
     or new.approver_role <> old.approver_role then
    raise exception 'approval step is immutable';
  end if;

  if old.status <> 'pending' then
    raise exception 'approval step already finalized';
  end if;

  if new.status = 'pending' then
    if new.action_by is not null or new.action_at is not null then
      raise exception 'approval step is immutable';
    end if;
  end if;

  if new.status in ('approved', 'rejected') then
    if new.action_by is null or new.action_at is null then
      raise exception 'approval step missing action_by/action_at';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lock_approval_steps on public.approval_steps;
create trigger trg_lock_approval_steps
before update or delete on public.approval_steps
for each row execute function public.trg_lock_approval_steps();
