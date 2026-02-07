do $$
begin
  if to_regclass('public.app_settings') is null or to_regclass('public.chart_of_accounts') is null then
    return;
  end if;

  create or replace function public.resolve_account_ref(p_value text)
  returns uuid
  language plpgsql
  stable
  security definer
  set search_path = public
  as $fn$
  declare
    v_text text;
    v_id uuid;
  begin
    v_text := nullif(btrim(coalesce(p_value, '')), '');
    if v_text is null then
      return null;
    end if;

    begin
      v_id := v_text::uuid;
      return v_id;
    exception when others then
      v_id := null;
    end;

    return public.get_account_id_by_code(v_text);
  end;
  $fn$;

  create or replace function public.trg_validate_app_settings_accounting_accounts()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_accounts jsonb;
    v_key text;
    v_val text;
    v_id uuid;
    v_active boolean;
  begin
    if public._is_migration_actor() then
      return new;
    end if;

    if new.id is distinct from 'singleton' and new.id is distinct from 'app' then
      return new;
    end if;

    v_accounts := coalesce(
      new.data->'settings'->'accounting_accounts',
      new.data->'accounting_accounts'
    );

    if v_accounts is null then
      return new;
    end if;

    foreach v_key in array array[
      'sales',
      'sales_returns',
      'inventory',
      'cogs',
      'ar',
      'ap',
      'vat_payable',
      'vat_recoverable',
      'cash',
      'bank',
      'deposits',
      'expenses',
      'shrinkage',
      'gain',
      'delivery_income',
      'sales_discounts',
      'over_short'
    ]
    loop
      v_val := nullif(btrim(coalesce(v_accounts->>v_key, '')), '');
      if v_val is null then
        raise exception 'missing accounting_accounts.%', v_key;
      end if;

      v_id := public.resolve_account_ref(v_val);
      if v_id is null then
        raise exception 'invalid accounting_accounts.%', v_key;
      end if;

      select coalesce(coa.is_active, false)
      into v_active
      from public.chart_of_accounts coa
      where coa.id = v_id
      limit 1;

      if coalesce(v_active, false) = false then
        raise exception 'inactive accounting_accounts.%', v_key;
      end if;
    end loop;

    return new;
  end;
  $fn$;

  drop trigger if exists trg_app_settings_validate_accounting_accounts on public.app_settings;
  create trigger trg_app_settings_validate_accounting_accounts
  before insert or update on public.app_settings
  for each row execute function public.trg_validate_app_settings_accounting_accounts();
end $$;

notify pgrst, 'reload schema';
