create or replace function public.rpc_list_public_functions(p_like text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result text[];
begin
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
  into v_result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname ilike p_like;
  return coalesce(v_result, array[]::text[]);
end;
$$;

revoke all on function public.rpc_list_public_functions(text) from public;
grant execute on function public.rpc_list_public_functions(text) to anon, authenticated;
select pg_sleep(1);
notify pgrst, 'reload schema';

