set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text := 'SAR';
begin
  if to_regclass('public.currencies') is null then
    raise exception 'currencies table missing';
  end if;
  if to_regclass('public.app_settings') is null then
    raise exception 'app_settings table missing';
  end if;

  insert into public.currencies(code, name, is_base, is_high_inflation)
  values ('SAR', 'Saudi Riyal', true, false)
  on conflict (code) do update
  set is_base = true,
      is_high_inflation = false,
      name = coalesce(excluded.name, public.currencies.name);

  update public.currencies
  set is_base = false
  where upper(code) <> v_base
    and is_base is distinct from false;

  update public.currencies
  set is_high_inflation = true
  where upper(code) = 'YER'
    and is_high_inflation is distinct from true;

  update public.currencies
  set is_high_inflation = false
  where upper(code) = v_base
    and is_high_inflation is distinct from false;

  insert into public.app_settings(id, data)
  values (
    'app',
    jsonb_build_object('id', 'app', 'settings', jsonb_build_object('baseCurrency', v_base::text), 'updatedAt', now()::text)
  )
  on conflict (id) do update
  set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb(v_base::text), true),
      updated_at = now();

  insert into public.app_settings(id, data)
  values (
    'singleton',
    jsonb_build_object('id', 'singleton', 'settings', jsonb_build_object('baseCurrency', v_base::text), 'updatedAt', now()::text)
  )
  on conflict (id) do update
  set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb(v_base::text), true),
      updated_at = now();
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
  if v_settings_base is distinct from 'SAR' then
    raise exception 'base currency locked to SAR (app_settings=%)', v_settings_base;
  end if;

  select count(*) into v_base_count from public.currencies c where c.is_base = true;
  if v_base_count <> 1 then
    raise exception 'invalid base currency state in currencies (count=%)', v_base_count;
  end if;
  select upper(c.code) into v_currency_base from public.currencies c where c.is_base = true limit 1;
  if v_currency_base is distinct from 'SAR' then
    raise exception 'base currency locked to SAR (currencies=%)', v_currency_base;
  end if;

  return 'SAR';
end;
$$;

create or replace function public.set_base_currency(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'base currency is locked to SAR';
end;
$$;

create or replace function public.trg_lock_base_currency_sar_currencies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    raise exception 'currency code required';
  end if;

  if upper(new.code) = 'SAR' then
    new.is_base := true;
    new.is_high_inflation := false;
  else
    if coalesce(new.is_base, false) = true then
      raise exception 'base currency is locked to SAR';
    end if;
    if upper(new.code) = 'YER' then
      new.is_high_inflation := true;
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.currencies') is not null then
    drop trigger if exists trg_lock_base_currency_sar_currencies on public.currencies;
    create trigger trg_lock_base_currency_sar_currencies
    before insert or update on public.currencies
    for each row execute function public.trg_lock_base_currency_sar_currencies();
  end if;
end $$;

create or replace function public.trg_lock_base_currency_sar_app_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
begin
  if new.id in ('app','singleton') then
    v_base := upper(nullif(btrim(coalesce(new.data->'settings'->>'baseCurrency','')), ''));
    if v_base is distinct from 'SAR' then
      raise exception 'base currency is locked to SAR';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.app_settings') is not null then
    drop trigger if exists trg_lock_base_currency_sar_app_settings on public.app_settings;
    create trigger trg_lock_base_currency_sar_app_settings
    before insert or update on public.app_settings
    for each row execute function public.trg_lock_base_currency_sar_app_settings();
  end if;
end $$;

create or replace function public.trg_journal_lines_sar_base_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.get_base_currency();
begin
  if new.currency_code is not null and upper(new.currency_code) = upper(v_base) then
    new.currency_code := null;
  end if;

  if new.currency_code is null then
    if new.foreign_amount is not null or new.fx_rate is not null then
      raise exception 'base journal line cannot include foreign_amount/fx_rate';
    end if;
    return new;
  end if;

  if upper(new.currency_code) <> upper(v_base) then
    if new.fx_rate is not null and abs(new.fx_rate - 1) <= 1e-12 then
      raise exception 'fx_rate=1 is not allowed for non-base currency';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.journal_lines') is not null then
    drop trigger if exists trg0_journal_lines_sar_base_invariants on public.journal_lines;
    create trigger trg0_journal_lines_sar_base_invariants
    before insert on public.journal_lines
    for each row execute function public.trg_journal_lines_sar_base_invariants();
  end if;
end $$;

notify pgrst, 'reload schema';

