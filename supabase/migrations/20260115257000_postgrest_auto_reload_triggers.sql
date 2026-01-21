create or replace function public.pgrst_ddl_watch() returns event_trigger
language plpgsql
as $$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
  loop
    if cmd.command_tag in (
      'CREATE FUNCTION','ALTER FUNCTION','DROP FUNCTION',
      'CREATE TABLE','ALTER TABLE','DROP TABLE',
      'CREATE VIEW','ALTER VIEW','DROP VIEW',
      'COMMENT'
    ) and cmd.schema_name is distinct from 'pg_temp' then
      perform pg_notify('pgrst','reload schema');
    end if;
  end loop;
end; $$;

create or replace function public.pgrst_drop_watch() returns event_trigger
language plpgsql
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_dropped_objects()
  loop
    if obj.object_type in ('function','table','view','type','trigger','schema','rule')
       and obj.is_temporary is false then
      perform pg_notify('pgrst','reload schema');
    end if;
  end loop;
end; $$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_ddl_watch') then
    create event trigger pgrst_ddl_watch
      on ddl_command_end
      execute procedure public.pgrst_ddl_watch();
  end if;
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_drop_watch') then
    create event trigger pgrst_drop_watch
      on sql_drop
      execute procedure public.pgrst_drop_watch();
  end if;
end $$;

select pg_sleep(1);
notify pgrst, 'reload schema';

