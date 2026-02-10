set app.allow_ledger_ddl = '1';

create table if not exists public.item_uom_units (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  uom_id uuid not null references public.uom(id),
  qty_in_base numeric not null check (qty_in_base > 0),
  is_active boolean not null default true,
  is_default_purchase boolean not null default false,
  is_default_sales boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, uom_id)
);

alter table public.item_uom_units enable row level security;
drop policy if exists item_uom_units_admin_all on public.item_uom_units;
create policy item_uom_units_admin_all on public.item_uom_units
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_item_uom_units_updated_at on public.item_uom_units;
create trigger trg_item_uom_units_updated_at
before update on public.item_uom_units
for each row execute function public.set_updated_at();

create or replace function public.ensure_uom_code(p_code text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
begin
  v_code := lower(btrim(coalesce(p_code, '')));
  if v_code = '' then
    raise exception 'uom code required';
  end if;
  select id into v_id from public.uom where code = v_code limit 1;
  if v_id is null then
    insert into public.uom(code, name)
    values (v_code, coalesce(nullif(btrim(p_name), ''), v_code))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.item_qty_to_base(p_item_id text, p_qty numeric, p_uom_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base uuid;
  v_factor numeric;
begin
  if nullif(btrim(coalesce(p_item_id, '')), '') is null then
    raise exception 'item_id required';
  end if;
  if p_qty is null then
    return 0;
  end if;

  select base_uom_id into v_base
  from public.item_uom
  where item_id = p_item_id
  limit 1;

  if v_base is null then
    raise exception 'base uom missing for item';
  end if;

  if p_uom_id is null or p_uom_id = v_base then
    return p_qty;
  end if;

  select qty_in_base into v_factor
  from public.item_uom_units
  where item_id = p_item_id
    and uom_id = p_uom_id
    and is_active = true
  limit 1;

  if v_factor is not null and v_factor > 0 then
    return p_qty * v_factor;
  end if;

  return public.convert_qty(p_qty, p_uom_id, v_base);
end;
$$;

create or replace function public.item_unit_cost_to_base(p_item_id text, p_unit_cost numeric, p_uom_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base uuid;
  v_factor numeric;
begin
  if nullif(btrim(coalesce(p_item_id, '')), '') is null then
    raise exception 'item_id required';
  end if;
  if p_unit_cost is null then
    return 0;
  end if;

  select base_uom_id into v_base
  from public.item_uom
  where item_id = p_item_id
  limit 1;

  if v_base is null then
    raise exception 'base uom missing for item';
  end if;

  if p_uom_id is null or p_uom_id = v_base then
    return p_unit_cost;
  end if;

  select qty_in_base into v_factor
  from public.item_uom_units
  where item_id = p_item_id
    and uom_id = p_uom_id
    and is_active = true
  limit 1;

  if v_factor is not null and v_factor > 0 then
    return p_unit_cost / v_factor;
  end if;

  raise exception 'missing item uom factor';
end;
$$;

create or replace function public.upsert_item_packaging_uom(
  p_item_id text,
  p_pack_size numeric default null,
  p_carton_size numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item text;
  v_base uuid;
  v_pack uuid;
  v_carton uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('items.manage') or public.has_admin_permission('inventory.manage')) then
    raise exception 'not allowed';
  end if;
  v_item := nullif(btrim(coalesce(p_item_id, '')), '');
  if v_item is null then
    raise exception 'item_id required';
  end if;

  select base_uom_id into v_base
  from public.item_uom
  where item_id = v_item
  limit 1;

  if v_base is null then
    perform public.ensure_uom_code('piece', 'Piece');
    insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
    select mi.id, public.ensure_uom_code(lower(btrim(coalesce(mi.base_unit, mi.unit_type, 'piece'))), null), null, null
    from public.menu_items mi
    where mi.id = v_item
    on conflict (item_id) do nothing;

    select base_uom_id into v_base
    from public.item_uom
    where item_id = v_item
    limit 1;
  end if;

  if v_base is null then
    raise exception 'base uom missing for item';
  end if;

  insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
  values (v_item, v_base, 1, true)
  on conflict (item_id, uom_id)
  do update set qty_in_base = 1, is_active = true, updated_at = now();

  v_pack := public.ensure_uom_code('pack', 'Pack');
  v_carton := public.ensure_uom_code('carton', 'Carton');

  if coalesce(p_pack_size, 0) > 0 then
    insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
    values (v_item, v_pack, p_pack_size, true)
    on conflict (item_id, uom_id)
    do update set qty_in_base = excluded.qty_in_base, is_active = true, updated_at = now();
  else
    update public.item_uom_units
    set is_active = false, updated_at = now()
    where item_id = v_item and uom_id = v_pack;
  end if;

  if coalesce(p_carton_size, 0) > 0 then
    insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
    values (v_item, v_carton, p_carton_size, true)
    on conflict (item_id, uom_id)
    do update set qty_in_base = excluded.qty_in_base, is_active = true, updated_at = now();
  else
    update public.item_uom_units
    set is_active = false, updated_at = now()
    where item_id = v_item and uom_id = v_carton;
  end if;

  return jsonb_build_object(
    'itemId', v_item,
    'baseUomId', v_base::text,
    'packUomId', v_pack::text,
    'cartonUomId', v_carton::text,
    'packSize', nullif(coalesce(p_pack_size, 0), 0),
    'cartonSize', nullif(coalesce(p_carton_size, 0), 0)
  );
end;
$$;

revoke all on function public.upsert_item_packaging_uom(text, numeric, numeric) from public;
grant execute on function public.upsert_item_packaging_uom(text, numeric, numeric) to authenticated;

create or replace function public.list_item_uom_units(p_item_id text)
returns table(
  uom_id uuid,
  uom_code text,
  uom_name text,
  qty_in_base numeric,
  is_active boolean,
  is_default_purchase boolean,
  is_default_sales boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    iuu.uom_id,
    u.code as uom_code,
    u.name as uom_name,
    iuu.qty_in_base,
    iuu.is_active,
    iuu.is_default_purchase,
    iuu.is_default_sales
  from public.item_uom_units iuu
  join public.uom u on u.id = iuu.uom_id
  where iuu.item_id = p_item_id
  order by
    case when iuu.qty_in_base = 1 then 0 else 1 end,
    lower(u.code);
$$;

revoke all on function public.list_item_uom_units(text) from public;
grant execute on function public.list_item_uom_units(text) to authenticated;

insert into public.uom(code, name)
values ('pack','Pack')
on conflict (code) do nothing;

insert into public.uom(code, name)
values ('carton','Carton')
on conflict (code) do nothing;

insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
select iu.item_id, iu.base_uom_id, 1, true
from public.item_uom iu
join public.menu_items mi on mi.id = iu.item_id
where not exists (
  select 1
  from public.item_uom_units x
  where x.item_id = iu.item_id and x.uom_id = iu.base_uom_id
);

notify pgrst, 'reload schema';
