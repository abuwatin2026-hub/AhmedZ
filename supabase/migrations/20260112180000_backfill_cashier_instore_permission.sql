do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;

  update public.admin_users au
  set permissions = (
    select array_agg(distinct p)
    from unnest(au.permissions || array['orders.createInStore']) p
  )
  where au.role = 'cashier'
    and au.permissions is not null
    and cardinality(au.permissions) > 0
    and not ('orders.createInStore' = any(au.permissions));
end $$;
