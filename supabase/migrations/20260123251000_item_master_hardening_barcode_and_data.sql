create or replace function public.trg_menu_items_harden_definition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barcode text;
  v_has_conflict boolean;
  v_price_text text;
  v_price numeric;
begin
  if tg_op in ('INSERT','UPDATE') then
    if jsonb_typeof(new.data) <> 'object' then
      raise exception 'menu_items.data must be an object';
    end if;

    if jsonb_typeof(new.data->'name') <> 'object'
      or coalesce(btrim(new.data->'name'->>'ar'), '') = ''
    then
      raise exception 'item name.ar is required';
    end if;

    v_price_text := nullif(btrim(new.data->>'price'), '');
    if v_price_text is null then
      raise exception 'item price is required';
    end if;

    begin
      v_price := v_price_text::numeric;
    exception when others then
      raise exception 'item price must be numeric';
    end;

    if v_price < 0 then
      raise exception 'item price must be >= 0';
    end if;

    if new.status is null or btrim(new.status) = '' then
      new.status := 'active';
    end if;

    v_barcode := nullif(lower(btrim(coalesce(new.data->>'barcode', ''))), '');
    if v_barcode is not null and new.status = 'active' then
      select exists(
        select 1
        from public.menu_items mi
        where mi.id <> new.id
          and mi.status = 'active'
          and nullif(lower(btrim(coalesce(mi.data->>'barcode',''))), '') = v_barcode
      )
      into v_has_conflict;

      if v_has_conflict then
        raise exception 'barcode already exists';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_menu_items_harden_definition on public.menu_items;
create trigger trg_menu_items_harden_definition
before insert or update on public.menu_items
for each row execute function public.trg_menu_items_harden_definition();
