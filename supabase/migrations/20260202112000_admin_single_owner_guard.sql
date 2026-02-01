do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;
  update public.admin_users au
  set role = 'manager', updated_at = now()
  where au.role = 'owner'
    and au.auth_user_id <> (
      select x.auth_user_id
      from public.admin_users x
      where x.role = 'owner'
      order by x.created_at asc, x.auth_user_id asc
      limit 1
    );
end $$;

create or replace function public.prevent_multiple_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner' then
    if exists (
      select 1
      from public.admin_users au
      where au.auth_user_id <> coalesce(new.auth_user_id, old.auth_user_id)
        and au.role = 'owner'
    ) then
      raise exception 'only_one_owner';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_single_owner on public.admin_users;
create trigger trg_admin_single_owner
before insert or update on public.admin_users
for each row
execute function public.prevent_multiple_owners();
