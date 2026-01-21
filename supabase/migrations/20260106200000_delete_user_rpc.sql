-- Function to allow admins to completely delete a user (including auth account)
create or replace function public.delete_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Verify the caller is an admin
  if not public.is_admin() then
    raise exception 'Access denied: Only admins can delete users.';
  end if;

  -- 2. Delete from auth.users
  -- This will cascade to public.customers (ON DELETE CASCADE)
  -- This will set public.orders.customer_auth_user_id to NULL (ON DELETE SET NULL)
  delete from auth.users where id = target_user_id;

  -- Note: If the user doesn't exist in auth.users (e.g. only in public.customers due to sync error),
  -- we should also ensure public.customers is cleaned up.
  -- But cascade handles the common case.
  delete from public.customers where auth_user_id = target_user_id;
end;
$$;
-- Grant execute permission to authenticated users (logic inside handles authorization)
grant execute on function public.delete_user_account(uuid) to authenticated;
