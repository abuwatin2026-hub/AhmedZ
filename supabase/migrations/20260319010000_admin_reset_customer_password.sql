-- ================================================================
-- Admin: reset customer password directly in auth.users
-- Only callable by authenticated users with customers.manage permission
-- ================================================================

create or replace function public.admin_reset_customer_password(
  p_user_id uuid,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_role text;
  v_hash text;
begin
  -- 1. Only allow admins (owner / manager) — checked via RLS caller role in raw_user_meta_data
  select raw_user_meta_data->>'role' into v_role
  from auth.users
  where id = auth.uid()
  limit 1;

  if v_role not in ('owner', 'manager') then
    raise exception 'permission_denied';
  end if;

  -- 2. Validate password length
  if length(p_new_password) < 6 then
    raise exception 'password_too_short';
  end if;

  -- 3. Check target user exists and is a customer (not admin)
  if not exists (
    select 1 from public.customers where auth_user_id = p_user_id limit 1
  ) then
    raise exception 'customer_not_found';
  end if;

  -- 4. Hash the new password (bcrypt cost 10, matching GoTrue default)
  v_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));

  -- 5. Update auth.users
  update auth.users
  set
    encrypted_password = v_hash,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'auth_user_not_found';
  end if;

  return jsonb_build_object('success', true, 'user_id', p_user_id);

exception
  when sqlstate 'P0001' then raise; -- re-raise our own exceptions
end;
$$;

-- Only authenticated users can call (permission check is inside)
grant execute on function public.admin_reset_customer_password(uuid, text) to authenticated;

notify pgrst, 'reload schema';
