do $$
declare
  v_owner_id uuid;
  v_username text := 'owner';
begin
  -- Find owner user by standard email
  select u.id
  into v_owner_id
  from auth.users u
  where lower(u.email) = 'owner@azta.com'
  limit 1;

  if v_owner_id is null then
    -- Try fallback: earliest admin_users row with role owner (if exists)
    begin
      select au.auth_user_id
      into v_owner_id
      from public.admin_users au
      where au.role = 'owner'
      order by au.created_at asc
      limit 1;
    exception when others then
      v_owner_id := null;
    end;
  end if;

  if v_owner_id is null then
    raise notice 'Owner auth user not found. Ensure auth.users has owner@azta.com';
    return;
  end if;

  -- Upsert owner row in admin_users
  insert into public.admin_users(auth_user_id, username, full_name, email, role, is_active)
  values (v_owner_id, v_username, 'Owner', 'owner@azta.com', 'owner', true)
  on conflict (auth_user_id) do update
  set role = 'owner',
      is_active = true,
      username = coalesce(public.admin_users.username, v_username),
      email = coalesce(public.admin_users.email, 'owner@azta.com'),
      updated_at = now();
end $$;

notify pgrst, 'reload schema';
