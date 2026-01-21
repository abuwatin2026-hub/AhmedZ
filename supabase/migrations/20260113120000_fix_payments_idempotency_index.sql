-- Fix ON CONFLICT usage for payments idempotency by aligning unique index
do $$
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_payments_reference_idempotency'
  ) then
    delete from public.payments p
    using public.payments p2
    where p.ctid < p2.ctid
      and p.reference_table = p2.reference_table
      and p.reference_id = p2.reference_id
      and p.direction = p2.direction
      and p.idempotency_key = p2.idempotency_key
      and p.idempotency_key is not null;

    drop index if exists public.uq_payments_reference_idempotency;
  end if;
end;
$$;
create unique index if not exists uq_payments_reference_idempotency
on public.payments(reference_table, reference_id, direction, idempotency_key);
