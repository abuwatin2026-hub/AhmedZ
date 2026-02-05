do $$
begin
  if to_regclass('private.keys') is not null then
    if not exists (
      select 1
      from private.keys
      where key_name = 'app.encryption_key'
    ) then
      insert into private.keys(key_name, key_value)
      values ('app.encryption_key', concat('dev-', gen_random_uuid()::text, gen_random_uuid()::text));
    end if;
  end if;
end $$;
