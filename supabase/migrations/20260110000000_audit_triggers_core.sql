create or replace function public.audit_changed_columns(p_old jsonb, p_new jsonb)
returns text[]
language plpgsql
as $$
declare
  k text;
  keys text[];
  result text[] := '{}'::text[];
begin
  if p_old is null then
    p_old := '{}'::jsonb;
  end if;
  if p_new is null then
    p_new := '{}'::jsonb;
  end if;

  select array_agg(distinct key)
  into keys
  from (
    select jsonb_object_keys(p_old) as key
    union all
    select jsonb_object_keys(p_new) as key
  ) s;

  if keys is null then
    return result;
  end if;

  foreach k in array keys loop
    if (p_old -> k) is distinct from (p_new -> k) then
      result := array_append(result, k);
    end if;
  end loop;

  return result;
end;
$$;
create or replace function public.audit_table_module(p_table text)
returns text
language plpgsql
as $$
begin
  case p_table
    when 'admin_users' then return 'auth';
    when 'customers' then return 'customers';
    when 'menu_items' then return 'inventory';
    when 'addons' then return 'inventory';
    when 'delivery_zones' then return 'orders';
    when 'coupons' then return 'orders';
    when 'ads' then return 'marketing';
    when 'challenges' then return 'marketing';
    when 'app_settings' then return 'settings';
    when 'item_categories' then return 'inventory';
    when 'unit_types' then return 'inventory';
    when 'freshness_levels' then return 'inventory';
    when 'banks' then return 'settings';
    when 'transfer_recipients' then return 'settings';
    when 'reviews' then return 'reviews';
    else
      return 'system';
  end case;
end;
$$;
create or replace function public.audit_get_record_id(p_table text, p_row jsonb)
returns text
language plpgsql
as $$
begin
  if p_row is null then
    return null;
  end if;

  case p_table
    when 'admin_users' then return p_row->>'auth_user_id';
    when 'customers' then return p_row->>'auth_user_id';
    when 'orders' then return p_row->>'id';
    when 'menu_items' then return p_row->>'id';
    when 'addons' then return p_row->>'id';
    when 'delivery_zones' then return p_row->>'id';
    when 'coupons' then return p_row->>'id';
    when 'ads' then return p_row->>'id';
    when 'challenges' then return p_row->>'id';
    when 'app_settings' then return p_row->>'id';
    when 'item_categories' then return p_row->>'id';
    when 'unit_types' then return p_row->>'id';
    when 'freshness_levels' then return p_row->>'id';
    when 'banks' then return p_row->>'id';
    when 'transfer_recipients' then return p_row->>'id';
    when 'reviews' then return p_row->>'id';
    else
      if (p_row ? 'id') then return p_row->>'id'; end if;
      return null;
  end case;
end;
$$;
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := tg_table_name;
  v_op text := lower(tg_op);
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_record_id text;
  v_changed text[];
  v_changed_filtered text[] := '{}'::text[];
  v_key text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_table in ('customers', 'reviews') and not public.is_admin() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
    v_changed := '{}'::text[];
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    v_changed := public.audit_changed_columns(v_old, v_new);
    if v_changed is not null then
      foreach v_key in array v_changed loop
        if v_key not in ('updated_at', 'created_at') then
          v_changed_filtered := array_append(v_changed_filtered, v_key);
        end if;
      end loop;
    end if;
    if array_length(v_changed_filtered, 1) is null then
      return new;
    end if;
    v_changed := v_changed_filtered;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
    v_changed := '{}'::text[];
  end if;

  v_record_id := public.audit_get_record_id(v_table, v_row);

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    v_table || '.' || v_op,
    public.audit_table_module(v_table),
    jsonb_build_object(
      'recordId', v_record_id,
      'changedColumns', v_changed
    )::text,
    auth.uid(),
    now(),
    jsonb_build_object(
      'table', v_table,
      'op', v_op,
      'recordId', v_record_id,
      'changedColumns', v_changed
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_admin_users on public.admin_users;
create trigger trg_audit_admin_users
after insert or update or delete on public.admin_users
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_customers on public.customers;
create trigger trg_audit_customers
after insert or update or delete on public.customers
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_menu_items on public.menu_items;
create trigger trg_audit_menu_items
after insert or update or delete on public.menu_items
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_addons on public.addons;
create trigger trg_audit_addons
after insert or update or delete on public.addons
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_delivery_zones on public.delivery_zones;
create trigger trg_audit_delivery_zones
after insert or update or delete on public.delivery_zones
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_coupons on public.coupons;
create trigger trg_audit_coupons
after insert or update or delete on public.coupons
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_ads on public.ads;
create trigger trg_audit_ads
after insert or update or delete on public.ads
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_challenges on public.challenges;
create trigger trg_audit_challenges
after insert or update or delete on public.challenges
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_app_settings on public.app_settings;
create trigger trg_audit_app_settings
after insert or update or delete on public.app_settings
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_item_categories on public.item_categories;
create trigger trg_audit_item_categories
after insert or update or delete on public.item_categories
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_unit_types on public.unit_types;
create trigger trg_audit_unit_types
after insert or update or delete on public.unit_types
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_freshness_levels on public.freshness_levels;
create trigger trg_audit_freshness_levels
after insert or update or delete on public.freshness_levels
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_banks on public.banks;
create trigger trg_audit_banks
after insert or update or delete on public.banks
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_transfer_recipients on public.transfer_recipients;
create trigger trg_audit_transfer_recipients
after insert or update or delete on public.transfer_recipients
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_reviews on public.reviews;
create trigger trg_audit_reviews
after insert or update or delete on public.reviews
for each row execute function public.audit_row_change();
