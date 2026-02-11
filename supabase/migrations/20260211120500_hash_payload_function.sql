set app.allow_ledger_ddl = '1';

create or replace function public.hash_payload(p_payload jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_text text;
begin
  v_text := coalesce(p_payload::text, '');
  begin
    return encode(digest(v_text, 'sha256'), 'hex');
  exception when others then
    return md5(v_text);
  end;
end;
$$;

revoke all on function public.hash_payload(jsonb) from public;
grant execute on function public.hash_payload(jsonb) to authenticated;

notify pgrst, 'reload schema';
