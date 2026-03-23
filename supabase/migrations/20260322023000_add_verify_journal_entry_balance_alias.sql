create or replace function public.verify_journal_entry_balance(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_journal_entry_balance(p_entry_id);
end;
$$;

revoke all on function public.verify_journal_entry_balance(uuid) from public;
grant execute on function public.verify_journal_entry_balance(uuid) to authenticated;

notify pgrst, 'reload schema';
