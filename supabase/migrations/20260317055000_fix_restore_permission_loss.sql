-- Fix Wipe & Restore: 3 critical bugs
-- Bug 1: Wipe deletes admin_users → user loses permission → import fails
-- Bug 2: app_settings trigger validates currencies → fails on empty DB
-- Bug 3: Import re-enables triggers per table → FK violations
--
-- Solution:
-- Wipe: disable triggers → insert restore flag → truncate → re-insert admin
-- Import: skip trigger re-enable during restore mode
-- Resync: re-enable triggers + clear flag

-- ============================================
-- 1. admin_wipe_all_tables_for_restore
-- ============================================
create or replace function public.admin_wipe_all_tables_for_restore()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_sql text;
  v_current_auth_id uuid;
  v_current_username text;
  v_current_full_name text;
  v_current_email text;
  v_current_role text;
  v_current_permissions text[];
  v_skip text[] := array[
    'schema_migrations',
    'supabase_migrations',
    'spatial_ref_sys',
    'geography_columns',
    'geometry_columns'
  ];
begin
  if not public.has_admin_permission('system.settings') then
    raise exception 'Unauthorized: Requires system.settings permission';
  end if;

  perform set_config('app.restore_in_progress', '1', true);

  -- Save current user
  v_current_auth_id := auth.uid();
  select username, full_name, email, role, permissions
  into v_current_username, v_current_full_name, v_current_email, v_current_role, v_current_permissions
  from public.admin_users
  where auth_user_id = v_current_auth_id
  limit 1;

  -- Disable USER triggers on ALL tables FIRST
  for v_table in
    select t.table_name from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not like 'pg_%' and t.table_name not like '_pg_%'
  loop
    begin
      execute format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
    exception when others then
      raise notice 'disable trig %: %', v_table, sqlerrm;
    end;
  end loop;

  -- Insert persistent restore flag (triggers now disabled)
  insert into public.app_settings (id, data)
  values ('restore_in_progress', '{"active": true}'::jsonb)
  on conflict (id) do update set data = '{"active": true}'::jsonb;

  -- Truncate all tables except app_settings
  for v_table in
    select t.table_name from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not like 'pg_%' and t.table_name not like '_pg_%'
      and t.table_name != 'app_settings'
    order by t.table_name
  loop
    if v_table = any(v_skip) then continue; end if;
    begin
      execute format('TRUNCATE TABLE public.%I CASCADE', v_table);
    exception when others then
      raise notice 'truncate %: %', v_table, sqlerrm;
    end;
  end loop;

  -- Re-insert current user (cascade-deleted)
  if v_current_auth_id is not null and v_current_username is not null then
    begin
      insert into public.admin_users (auth_user_id, username, full_name, email, role, is_active, permissions, created_at, updated_at)
      values (v_current_auth_id, v_current_username, v_current_full_name, v_current_email,
              coalesce(v_current_role, 'owner'), true,
              coalesce(v_current_permissions, array['system.settings']), now(), now())
      on conflict (auth_user_id) do nothing;
    exception when others then
      raise notice 'admin re-insert: %', sqlerrm;
    end;
  end if;
  -- Triggers stay DISABLED - import handles them
end;
$$;

-- ============================================
-- 2. admin_import_table_data
-- ============================================
create or replace function public.admin_import_table_data(
  p_table text, p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text; v_pk_cols text; v_inserted int := 0;
  v_conflict_clause text; v_is_restore boolean := false;
begin
  begin
    select true into v_is_restore from public.app_settings where id = 'restore_in_progress';
  exception when others then v_is_restore := false;
  end;

  if not coalesce(v_is_restore, false) then
    if not public.has_admin_permission('system.settings') then
      raise exception 'Unauthorized: Requires system.settings permission';
    end if;
  end if;

  if jsonb_typeof(p_data) != 'array' then
    return jsonb_build_object('status', 'error', 'message', 'Data must be a JSON array');
  end if;
  if jsonb_array_length(p_data) = 0 then
    return jsonb_build_object('status', 'success', 'inserted_count', 0);
  end if;

  perform set_config('app.restore_in_progress', '1', true);

  begin
    execute format('ALTER TABLE public.%I DISABLE TRIGGER USER', p_table);
  exception when others then null;
  end;

  select string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) into v_pk_cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
    and kcu.table_schema = tc.table_schema and kcu.table_name = tc.table_name
  where tc.table_schema = 'public' and tc.table_name = p_table and tc.constraint_type = 'PRIMARY KEY';

  if v_pk_cols is not null and v_pk_cols != '' then
    v_conflict_clause := format('ON CONFLICT (%s) DO NOTHING', v_pk_cols);
  else
    v_conflict_clause := '';
  end if;

  begin
    v_sql := format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(null::public.%I, $1) %s', p_table, p_table, v_conflict_clause);
    execute v_sql using p_data;
    get diagnostics v_inserted = row_count;
  exception when others then
    begin
      v_sql := format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(null::public.%I, $1)', p_table, p_table);
      execute v_sql using p_data;
      get diagnostics v_inserted = row_count;
    exception when others then
      if not coalesce(v_is_restore, false) then
        begin execute format('ALTER TABLE public.%I ENABLE TRIGGER USER', p_table); exception when others then null; end;
      end if;
      return jsonb_build_object('status', 'error', 'message', sqlerrm, 'table', p_table);
    end;
  end;

  -- Only re-enable triggers if NOT restoring
  if not coalesce(v_is_restore, false) then
    begin
      execute format('ALTER TABLE public.%I ENABLE TRIGGER USER', p_table);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('status', 'success', 'inserted_count', v_inserted, 'table', p_table);
end;
$$;

-- ============================================
-- 3. admin_post_restore_resync
-- ============================================
create or replace function public.admin_post_restore_resync()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_restore boolean := false;
  v_table text;
begin
  begin
    select true into v_is_restore from public.app_settings where id = 'restore_in_progress';
  exception when others then v_is_restore := false;
  end;

  if not coalesce(v_is_restore, false) then
    if not public.has_admin_permission('system.settings') then
      raise exception 'Unauthorized: Requires system.settings permission';
    end if;
  end if;

  -- Re-enable USER triggers on ALL tables
  for v_table in
    select t.table_name from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not like 'pg_%' and t.table_name not like '_pg_%'
  loop
    begin
      execute format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    exception when others then
      raise notice 'enable trig %: %', v_table, sqlerrm;
    end;
  end loop;

  -- Clear restore flag
  delete from public.app_settings where id = 'restore_in_progress';
  perform set_config('app.restore_in_progress', '0', true);

  return jsonb_build_object('status', 'success', 'message', 'Triggers re-enabled, restore flag cleared');
end;
$$;

-- Permissions
revoke all on function public.admin_wipe_all_tables_for_restore() from public;
grant execute on function public.admin_wipe_all_tables_for_restore() to authenticated;
revoke all on function public.admin_import_table_data(text, jsonb) from public;
grant execute on function public.admin_import_table_data(text, jsonb) to authenticated;
revoke all on function public.admin_post_restore_resync() from public;
grant execute on function public.admin_post_restore_resync() to authenticated;

notify pgrst, 'reload schema';
