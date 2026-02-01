-- Prevent duplicate pending approval requests for the same target/request_type
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'uniq_approval_requests_pending'
  ) then
    create unique index uniq_approval_requests_pending
      on public.approval_requests(target_table, target_id, request_type)
      where status = 'pending';
  end if;
end $$;
