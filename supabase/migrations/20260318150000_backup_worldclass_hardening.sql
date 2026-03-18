create or replace function public.can_manage_backup()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.is_admin() or public.has_admin_permission('system.settings');
end;
$$;

create or replace function public.admin_backup_health_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checks jsonb := '[]'::jsonb;
  v_bucket_exists boolean := false;
  v_object_count bigint := 0;
  v_latest timestamptz := null;
  v_has_cron_job boolean := false;
begin
  if not public.can_manage_backup() then
    raise exception 'not allowed';
  end if;

  checks := checks || jsonb_build_object(
    'key', 'admin_get_all_tables',
    'ok', to_regprocedure('public.admin_get_all_tables()') is not null,
    'message', 'required rpc'
  );
  checks := checks || jsonb_build_object(
    'key', 'admin_export_table_data',
    'ok', (
      to_regprocedure('public.admin_export_table_data(text,bigint,bigint)') is not null
      or to_regprocedure('public.admin_export_table_data(text,integer,integer)') is not null
    ),
    'message', 'required rpc'
  );
  checks := checks || jsonb_build_object(
    'key', 'admin_import_table_data',
    'ok', to_regprocedure('public.admin_import_table_data(text,jsonb)') is not null,
    'message', 'required rpc'
  );
  checks := checks || jsonb_build_object(
    'key', 'admin_wipe_all_tables_for_restore',
    'ok', to_regprocedure('public.admin_wipe_all_tables_for_restore()') is not null,
    'message', 'required rpc'
  );
  checks := checks || jsonb_build_object(
    'key', 'admin_post_restore_resync',
    'ok', to_regprocedure('public.admin_post_restore_resync()') is not null,
    'message', 'required rpc'
  );

  select exists(select 1 from storage.buckets where id = 'automated_backups') into v_bucket_exists;
  checks := checks || jsonb_build_object(
    'key', 'automated_backups_bucket',
    'ok', v_bucket_exists,
    'message', case when v_bucket_exists then 'ok' else 'missing bucket' end
  );

  if v_bucket_exists then
    select count(*), max(created_at)
    into v_object_count, v_latest
    from storage.objects
    where bucket_id = 'automated_backups';
  end if;
  checks := checks || jsonb_build_object(
    'key', 'automated_backups_latest_object',
    'ok', v_object_count > 0,
    'message', case when v_object_count > 0 then concat('objects: ', v_object_count::text) else 'no backup objects found' end
  );

  if to_regclass('cron.job') is not null then
    select exists(
      select 1 from cron.job where jobname = 'nightly-automated-backup'
    ) into v_has_cron_job;
  end if;
  checks := checks || jsonb_build_object(
    'key', 'nightly_backup_job',
    'ok', v_has_cron_job,
    'message', case when v_has_cron_job then 'ok' else 'not scheduled' end
  );

  return jsonb_build_object(
    'ok', not exists(select 1 from jsonb_array_elements(checks) c where coalesce((c->>'ok')::boolean, false) = false),
    'checks', checks,
    'meta', jsonb_build_object(
      'automated_backups_count', v_object_count,
      'automated_backups_latest_at', v_latest
    )
  );
end;
$$;

create or replace function public.admin_register_automated_backup_job(
  p_function_url text,
  p_bearer_token text,
  p_cron text default '0 3 * * *'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id bigint;
begin
  if not public.can_manage_backup() then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_function_url), '') = '' or coalesce(trim(p_bearer_token), '') = '' then
    raise exception 'missing function url or bearer token';
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not enabled';
  end if;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'nightly-automated-backup';
  select cron.schedule(
    'nightly-automated-backup',
    p_cron,
    format(
      $sql$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
      $sql$,
      trim(p_function_url),
      'Bearer ' || trim(p_bearer_token)
    )
  ) into v_job_id;
  return format('scheduled job id: %s', v_job_id::text);
end;
$$;

grant execute on function public.admin_backup_health_report() to authenticated;
grant execute on function public.admin_register_automated_backup_job(text, text, text) to authenticated;

notify pgrst, 'reload schema';
