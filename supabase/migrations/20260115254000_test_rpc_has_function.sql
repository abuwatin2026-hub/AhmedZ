create or replace function public.rpc_has_function(p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select to_regproc(p_name) is not null;
$$;

revoke all on function public.rpc_has_function(text) from public;
grant execute on function public.rpc_has_function(text) to anon, authenticated;
select pg_sleep(1);
notify pgrst, 'reload schema';

