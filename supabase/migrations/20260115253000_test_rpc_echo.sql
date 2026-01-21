create or replace function public.rpc_echo_text(p_text text)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(p_text, '');
$$;

revoke all on function public.rpc_echo_text(text) from public;
grant execute on function public.rpc_echo_text(text) to anon, authenticated;
select pg_sleep(1);
notify pgrst, 'reload schema';

