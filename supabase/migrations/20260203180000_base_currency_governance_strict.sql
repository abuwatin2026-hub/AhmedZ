do $$
declare
  v_settings jsonb;
  v_settings_base text;
  v_currency_base text;
  v_base_count int;
begin
  if to_regclass('public.currencies') is null then
    raise exception 'currencies table missing';
  end if;
  if to_regclass('public.app_settings') is null then
    raise exception 'app_settings table missing';
  end if;

  select s.data
  into v_settings
  from public.app_settings s
  where s.id = 'app'
  limit 1;

  if v_settings is null then
    select s.data
    into v_settings
    from public.app_settings s
    where s.id = 'singleton'
    limit 1;
  end if;

  v_settings_base := upper(nullif(btrim(coalesce(v_settings->'settings'->>'baseCurrency', '')), ''));

  select count(*) into v_base_count from public.currencies c where c.is_base = true;
  if v_base_count = 1 then
    select upper(c.code) into v_currency_base from public.currencies c where c.is_base = true limit 1;
  else
    v_currency_base := null;
  end if;

  if v_settings_base is null and v_currency_base is null then
    raise exception 'base currency not configured';
  end if;

  if v_settings_base is null and v_currency_base is not null then
    insert into public.app_settings(id, data)
    values (
      'app',
      jsonb_build_object('id', 'app', 'settings', jsonb_build_object('baseCurrency', v_currency_base), 'updatedAt', now()::text)
    )
    on conflict (id) do update
    set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb(v_currency_base), true),
        updated_at = now();
    v_settings_base := v_currency_base;
  end if;

  if v_settings_base is not null and v_currency_base is null then
    update public.currencies set is_base = false where is_base = true;
    insert into public.currencies(code, name, is_base)
    values (v_settings_base, v_settings_base, true)
    on conflict (code) do update set is_base = true, name = coalesce(public.currencies.name, excluded.name);
    update public.currencies set is_base = false where upper(code) <> v_settings_base and is_base = true;
    v_currency_base := v_settings_base;
  end if;

  if v_settings_base is distinct from v_currency_base then
    raise exception 'base currency mismatch (app_settings=% , currencies=%)', v_settings_base, v_currency_base;
  end if;
end $$;

create or replace function public.get_base_currency()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_settings_base text;
  v_currency_base text;
  v_base_count int;
begin
  if to_regclass('public.app_settings') is null or to_regclass('public.currencies') is null then
    raise exception 'base currency configuration tables missing';
  end if;

  select s.data into v_settings
  from public.app_settings s
  where s.id = 'app'
  limit 1;

  if v_settings is null then
    select s.data into v_settings
    from public.app_settings s
    where s.id = 'singleton'
    limit 1;
  end if;

  v_settings_base := upper(nullif(btrim(coalesce(v_settings->'settings'->>'baseCurrency', '')), ''));
  if v_settings_base is null then
    raise exception 'base currency not configured in app_settings';
  end if;

  select count(*) into v_base_count from public.currencies c where c.is_base = true;
  if v_base_count <> 1 then
    raise exception 'invalid base currency state in currencies (count=%)', v_base_count;
  end if;
  select upper(c.code) into v_currency_base from public.currencies c where c.is_base = true limit 1;
  if v_currency_base is null then
    raise exception 'base currency not configured in currencies';
  end if;

  if v_settings_base <> v_currency_base then
    raise exception 'base currency mismatch (app_settings=% , currencies=%)', v_settings_base, v_currency_base;
  end if;

  return v_settings_base;
end;
$$;

create or replace function public.set_base_currency(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text;
  v_current text;
  v_has_postings boolean;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;
  v_new := upper(nullif(btrim(coalesce(p_code, '')), ''));
  if v_new is null then
    raise exception 'base currency code required';
  end if;
  v_has_postings := exists(select 1 from public.journal_entries);
  begin
    v_current := public.get_base_currency();
  exception when others then
    v_current := null;
  end;
  if v_has_postings and v_current is not null and v_new <> v_current then
    raise exception 'cannot change base currency after postings exist';
  end if;

  insert into public.app_settings(id, data)
  values (
    'app',
    jsonb_build_object('id', 'app', 'settings', jsonb_build_object('baseCurrency', v_new), 'updatedAt', now()::text)
  )
  on conflict (id) do update
  set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb(v_new), true),
      updated_at = now();

  update public.currencies set is_base = false where is_base = true and upper(code) <> v_new;
  insert into public.currencies(code, name, is_base)
  values (v_new, v_new, true)
  on conflict (code) do update set is_base = true, name = coalesce(public.currencies.name, excluded.name);
end;
$$;

revoke all on function public.set_base_currency(text) from public;
grant execute on function public.set_base_currency(text) to authenticated;

create or replace function public.trg_validate_base_currency_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.get_base_currency();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.app_settings') is not null then
    drop trigger if exists trg_validate_base_currency_config_app_settings on public.app_settings;
    create constraint trigger trg_validate_base_currency_config_app_settings
    after insert or update on public.app_settings
    deferrable initially deferred
    for each row execute function public.trg_validate_base_currency_config();
  end if;
  if to_regclass('public.currencies') is not null then
    drop trigger if exists trg_validate_base_currency_config_currencies on public.currencies;
    create constraint trigger trg_validate_base_currency_config_currencies
    after insert or update on public.currencies
    deferrable initially deferred
    for each row execute function public.trg_validate_base_currency_config();
  end if;
end $$;

notify pgrst, 'reload schema';
