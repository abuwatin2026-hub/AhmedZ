create or replace function public.trg_enforce_base_currency_singleton()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_postings boolean := false;
  v_other_base int := 0;
begin
  select exists(select 1 from public.journal_entries) into v_has_postings;

  if tg_op = 'INSERT' then
    if coalesce(new.is_base, false) then
      if exists(select 1 from public.currencies c where upper(c.code) = upper(new.code) and c.is_base = true) then
        return new;
      end if;

      select count(*)
      into v_other_base
      from public.currencies c
      where c.is_base = true and upper(c.code) <> upper(new.code);

      if v_other_base > 0 then
        if v_has_postings then
          raise exception 'cannot set another base currency after postings exist';
        else
          update public.currencies set is_base = false where is_base = true;
        end if;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.is_base, false) <> coalesce(new.is_base, false) then
      if v_has_postings then
        raise exception 'cannot change base currency after postings exist';
      end if;
    end if;
    if coalesce(new.is_base, false) then
      update public.currencies set is_base = false where upper(code) <> upper(new.code) and is_base = true;
    end if;
    return new;
  end if;

  return new;
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
  v_updated int;
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
  update public.currencies set is_base = true where upper(code) = v_new;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    insert into public.currencies(code, name, is_base)
    values (v_new, v_new, true);
  end if;
end;
$$;

revoke all on function public.set_base_currency(text) from public;
grant execute on function public.set_base_currency(text) to authenticated;

notify pgrst, 'reload schema';
