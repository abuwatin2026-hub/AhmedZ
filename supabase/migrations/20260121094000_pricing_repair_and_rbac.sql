do $$
declare
  v_customer_id_type text;
  v_table_exists boolean;
begin
  select exists(
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'customer_special_prices'
  )
  into v_table_exists;

  if v_table_exists then
    select t.typname
    into v_customer_id_type
    from pg_attribute a
    join pg_class c on a.attrelid = c.oid
    join pg_namespace n on c.relnamespace = n.oid
    join pg_type t on a.atttypid = t.oid
    where n.nspname = 'public'
      and c.relname = 'customer_special_prices'
      and a.attname = 'customer_id'
      and a.attnum > 0
      and not a.attisdropped;

    if coalesce(v_customer_id_type, '') <> 'uuid' then
      execute 'drop table if exists public.customer_special_prices__new';
      execute '
        create table public.customer_special_prices__new (
          id uuid primary key,
          customer_id uuid not null references public.customers(auth_user_id) on delete cascade,
          item_id text not null references public.menu_items(id) on delete cascade,
          special_price numeric not null check (special_price >= 0),
          valid_from date not null,
          valid_to date,
          notes text,
          created_by uuid references auth.users(id) on delete set null,
          created_at timestamptz default now(),
          updated_at timestamptz default now(),
          unique (customer_id, item_id)
        )';

      execute '
        insert into public.customer_special_prices__new (
          id,
          customer_id,
          item_id,
          special_price,
          valid_from,
          valid_to,
          notes,
          created_by,
          created_at,
          updated_at
        )
        select
          case
            when id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$''
              then id::text::uuid
            else gen_random_uuid()
          end,
          (customer_id::text)::uuid,
          item_id::text,
          coalesce(special_price, 0),
          valid_from,
          valid_to,
          notes,
          created_by,
          coalesce(created_at, now()),
          coalesce(updated_at, now())
        from public.customer_special_prices
        where customer_id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$''
      ';

      if to_regclass('public.customer_special_prices__legacy_text_customer_id') is null then
        execute 'alter table public.customer_special_prices rename to customer_special_prices__legacy_text_customer_id';
      else
        execute 'drop table if exists public.customer_special_prices cascade';
      end if;

      execute 'alter table public.customer_special_prices__new rename to customer_special_prices';
    end if;
  end if;
end $$;

alter table public.price_tiers enable row level security;
alter table public.customer_special_prices enable row level security;

drop policy if exists price_tiers_select on public.price_tiers;
create policy price_tiers_select on public.price_tiers for select using (public.is_admin());

drop policy if exists price_tiers_manage on public.price_tiers;
create policy price_tiers_manage on public.price_tiers
for all
using (public.has_admin_permission('prices.manage'))
with check (public.has_admin_permission('prices.manage'));

drop policy if exists special_prices_select on public.customer_special_prices;
create policy special_prices_select on public.customer_special_prices
for select
using (auth.uid() = customer_id or public.is_admin());

drop policy if exists special_prices_manage on public.customer_special_prices;
create policy special_prices_manage on public.customer_special_prices
for all
using (public.has_admin_permission('prices.manage'))
with check (public.has_admin_permission('prices.manage'));

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_price_tiers_updated_at on public.price_tiers;
create trigger trg_price_tiers_updated_at
before update on public.price_tiers
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_special_prices_updated_at on public.customer_special_prices;
create trigger trg_special_prices_updated_at
before update on public.customer_special_prices
for each row execute function public.update_updated_at_column();

drop function if exists public.get_item_price(text, text, numeric);
drop function if exists public.get_item_discount(text, text, numeric);
drop function if exists public.check_customer_credit_limit(text, numeric);
drop function if exists public.get_item_price(text, uuid, numeric);
drop function if exists public.get_item_discount(text, uuid, numeric);

revoke all on function public.get_item_price(text, numeric, uuid) from public;
grant execute on function public.get_item_price(text, numeric, uuid) to anon, authenticated;

revoke all on function public.get_item_discount(text, numeric, uuid) from public;
grant execute on function public.get_item_discount(text, numeric, uuid) to anon, authenticated;

revoke all on function public.get_item_all_prices(text) from public;
grant execute on function public.get_item_all_prices(text) to authenticated;

revoke all on function public.check_customer_credit_limit(uuid, numeric) from public;
grant execute on function public.check_customer_credit_limit(uuid, numeric) to authenticated;
