do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'private'
      and table_name = 'keys'
  ) then
    raise notice 'private.keys does not exist, skipping encryption key seed';
    return;
  end if;

  if not exists (
    select 1
    from private.keys
    where key_name = 'app.encryption_key'
  ) then
    insert into private.keys (key_name, key_value)
    values ('app.encryption_key', encode(gen_random_bytes(32), 'hex'))
    on conflict (key_name) do nothing;
  end if;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
