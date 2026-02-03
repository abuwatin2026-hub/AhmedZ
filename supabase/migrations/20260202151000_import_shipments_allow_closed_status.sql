do $$
declare
  v_constraint_name text;
begin
  if to_regclass('public.import_shipments') is null then
    return;
  end if;

  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'import_shipments'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if v_constraint_name is not null then
    execute format('alter table public.import_shipments drop constraint %I', v_constraint_name);
  end if;

  alter table public.import_shipments
    drop constraint if exists import_shipments_status_check,
    add constraint import_shipments_status_check
    check (status in ('draft', 'ordered', 'shipped', 'at_customs', 'cleared', 'delivered', 'closed', 'cancelled'));
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
