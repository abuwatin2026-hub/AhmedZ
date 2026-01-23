create or replace function public._resolve_default_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.warehouses w
  where w.is_active = true
    and upper(coalesce(w.code, '')) = 'MAIN'
  order by w.code asc
  limit 1;
$$;

revoke all on function public._resolve_default_warehouse_id() from public;
grant execute on function public._resolve_default_warehouse_id() to authenticated;
