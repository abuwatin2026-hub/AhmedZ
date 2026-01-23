do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'inventory_movements'
      and c.conname = 'purchase_in_requires_batch'
  ) then
    alter table public.inventory_movements
      add constraint purchase_in_requires_batch
      check (
        movement_type != 'purchase_in'
        or batch_id is not null
      )
      not valid;
  end if;
end;
$$;
