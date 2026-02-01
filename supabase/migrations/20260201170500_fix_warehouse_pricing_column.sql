do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='warehouses' and column_name='pricing'
  ) then
    alter table public.warehouses add column pricing jsonb not null default '{}'::jsonb;
  end if;
end $$;

create or replace function public._resolve_default_min_margin_pct(
  p_item_id text,
  p_warehouse_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_wh_pricing jsonb;
  v_settings jsonb;
  v_val numeric;
begin
  if p_item_id is null or btrim(p_item_id) = '' then
    return 0;
  end if;

  select data into v_item from public.menu_items mi where mi.id::text = p_item_id;
  if v_item is not null then
    begin
      v_val := nullif((v_item->'pricing'->>'minMarginPct')::numeric, null);
    exception when others then
      v_val := null;
    end;
    if v_val is not null then
      return greatest(0, v_val);
    end if;
  end if;

  if p_warehouse_id is not null then
    select pricing into v_wh_pricing from public.warehouses w where w.id = p_warehouse_id;
    if v_wh_pricing is not null then
      begin
        v_val := nullif((v_wh_pricing->>'defaultMinMarginPct')::numeric, null);
      exception when others then
        v_val := null;
      end;
      if v_val is not null then
        return greatest(0, v_val);
      end if;
    end if;
  end if;

  select data into v_settings from public.app_settings where id = 'singleton';
  if v_settings is not null then
    begin
      v_val := nullif((v_settings->'pricing'->>'defaultMinMarginPct')::numeric, null);
    exception when others then
      v_val := null;
    end;
    if v_val is not null then
      return greatest(0, v_val);
    end if;
  end if;

  return 0;
end;
$$;

revoke all on function public._resolve_default_min_margin_pct(text, uuid) from public;
revoke execute on function public._resolve_default_min_margin_pct(text, uuid) from anon;
grant execute on function public._resolve_default_min_margin_pct(text, uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
