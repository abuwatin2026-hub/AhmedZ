alter table public.batches
alter column qc_status set default 'released';

update public.batches b
set qc_status = 'released',
    updated_at = now()
where coalesce(b.qc_status, '') = 'quarantined'
  and coalesce(b.status, 'active') = 'active'
  and not exists (
    select 1 from public.batch_recalls br
    where br.batch_id = b.id and br.status = 'active'
  );

select pg_sleep(0.5);
notify pgrst, 'reload schema';
