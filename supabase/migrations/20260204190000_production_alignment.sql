do $$
begin
  if to_regclass('public.menu_items') is not null then
    begin
      alter table public.menu_items
        add column group_key text generated always as (
          upper(nullif(btrim(coalesce(data->>'group','')), ''))
        ) stored;
    exception when duplicate_column then
      null;
    end;
    create index if not exists idx_menu_items_group_key on public.menu_items(group_key);
  end if;
end $$;

create or replace function public.trg_set_order_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_currency text;
  v_rate numeric;
  v_total numeric;
  v_data_fx numeric;
begin
  v_base := public.get_base_currency();

  if tg_op = 'UPDATE' and coalesce(old.fx_locked, true) then
    new.currency := old.currency;
    new.fx_rate := old.fx_rate;
  else
    v_currency := upper(nullif(btrim(coalesce(new.currency, new.data->>'currency', '')), ''));
    if v_currency is null then
      v_currency := v_base;
    end if;
    new.currency := v_currency;

    if new.fx_rate is null then
      v_data_fx := null;
      begin
        v_data_fx := nullif((new.data->>'fxRate')::numeric, null);
      exception when others then
        v_data_fx := null;
      end;
      if v_data_fx is not null and v_data_fx > 0 then
        new.fx_rate := v_data_fx;
      else
        v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
        if v_rate is null then
          raise exception 'fx rate missing for currency %', new.currency;
        end if;
        new.fx_rate := v_rate;
      end if;
    end if;
  end if;

  v_total := 0;
  begin
    v_total := nullif((new.data->>'total')::numeric, null);
  exception when others then
    v_total := 0;
  end;
  new.base_total := coalesce(v_total, 0) * coalesce(new.fx_rate, 1);

  return new;
end;
$fn$;

drop trigger if exists trg_set_order_fx on public.orders;
create trigger trg_set_order_fx
before insert or update on public.orders
for each row execute function public.trg_set_order_fx();

create or replace function public.trg_block_sale_below_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
  v_order jsonb;
  v_line jsonb;
  v_unit_price numeric;
  v_item_id text;
  v_fx numeric;
  v_currency text;
  v_unit_price_base numeric;
begin
  if tg_op not in ('INSERT','UPDATE') then
    return new;
  end if;
  if new.movement_type <> 'sale_out' then
    return new;
  end if;
  if new.batch_id is null then
    return new;
  end if;
  if coalesce(new.reference_table,'') <> 'orders' or nullif(coalesce(new.reference_id,''),'') is null then
    return new;
  end if;

  select b.cost_per_unit, b.min_selling_price
  into v_batch
  from public.batches b
  where b.id = new.batch_id;

  select o.data, o.fx_rate, o.currency
  into v_order, v_fx, v_currency
  from public.orders o
  where o.id = (new.reference_id)::uuid;
  if v_order is null then
    return new;
  end if;

  v_item_id := new.item_id::text;
  v_unit_price := null;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_order->'items','[]'::jsonb))
  loop
    if coalesce(nullif(v_line->>'id',''), nullif(v_line->>'itemId','')) = v_item_id then
      begin
        v_unit_price := nullif((v_line->>'price')::numeric, null);
      exception when others then
        v_unit_price := null;
      end;
      exit;
    end if;
  end loop;

  if v_unit_price is null then
    return new;
  end if;

  v_unit_price_base := coalesce(v_unit_price, 0) * coalesce(v_fx, 1);
  if v_unit_price_base + 1e-9 < coalesce(v_batch.min_selling_price, 0) then
    raise exception 'SELLING_BELOW_COST_NOT_ALLOWED';
  end if;

  return new;
end;
$$;

drop view if exists public.v_sellable_products;

create view public.v_sellable_products as
with stock as (
  select sm.item_id::text as item_id,
         sum(coalesce(sm.available_quantity, 0)) as available_quantity
  from public.stock_management sm
  group by sm.item_id::text
),
valid_batches as (
  select
    b.item_id::text as item_id,
    bool_or(
      greatest(
        coalesce(b.quantity_received, 0)
        - coalesce(b.quantity_consumed, 0)
        - coalesce(b.quantity_transferred, 0),
        0
      ) > 0
      and coalesce(b.status, 'active') = 'active'
      and coalesce(b.qc_status, '') = 'released'
      and not exists (
        select 1 from public.batch_recalls br
        where br.batch_id = b.id and br.status = 'active'
      )
      and (b.expiry_date is null or b.expiry_date >= current_date)
    ) as has_valid_batch
  from public.batches b
  group by b.item_id::text
)
select
  mi.id,
  mi.name,
  mi.barcode,
  mi.price,
  mi.base_unit,
  mi.is_food,
  mi.expiry_required,
  mi.sellable,
  mi.status,
  coalesce(s.available_quantity, 0) as available_quantity,
  mi.category,
  mi.group_key,
  mi.is_featured,
  mi.freshness_level,
  mi.data
from public.menu_items mi
left join stock s on s.item_id = mi.id
left join valid_batches vb on vb.item_id = mi.id
where mi.status = 'active'
  and mi.sellable = true
  and coalesce(s.available_quantity, 0) > 0
  and (mi.expiry_required = false or coalesce(vb.has_valid_batch, false) = true);

alter view public.v_sellable_products set (security_invoker = false);
grant select on public.v_sellable_products to anon, authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
