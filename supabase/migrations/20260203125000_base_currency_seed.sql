-- Seed base currency configuration before strict FX governance applies
do $$
begin
  if to_regclass('public.currencies') is not null then
    insert into public.currencies(code, name, is_base)
    values ('YER', 'Yemeni Rial', true)
    on conflict (code) do update set is_base = true, name = coalesce(public.currencies.name, excluded.name);
    -- Ensure only one base flag
    update public.currencies set is_base = false where upper(code) <> 'YER' and is_base = true;
  end if;

  if to_regclass('public.app_settings') is not null then
    insert into public.app_settings(id, data)
    values (
      'app',
      jsonb_build_object('id', 'app', 'settings', jsonb_build_object('baseCurrency', 'YER'::text), 'updatedAt', now()::text)
    )
    on conflict (id) do update
    set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb('YER'::text), true),
        updated_at = now();
  end if;
end $$;

notify pgrst, 'reload schema';
