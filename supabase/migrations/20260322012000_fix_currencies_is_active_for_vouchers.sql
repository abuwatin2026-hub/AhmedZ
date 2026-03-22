do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'currencies'
      and column_name = 'is_active'
  ) then
    alter table public.currencies
      add column is_active boolean not null default true;
  end if;

  update public.currencies
  set is_active = true
  where is_active is null;
end
$$;

notify pgrst, 'reload schema';
