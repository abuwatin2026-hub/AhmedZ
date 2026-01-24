do $$
begin
  if to_regclass('public.promotions') is null then
    create table public.promotions (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      start_at timestamptz not null,
      end_at timestamptz not null,
      is_active boolean not null default false,
      discount_mode text not null check (discount_mode in ('fixed_total','percent_off')),
      fixed_total numeric,
      percent_off numeric,
      display_original_total numeric,
      max_uses int,
      stack_policy text not null default 'exclusive' check (stack_policy in ('exclusive')),
      exclusive_with_coupon boolean not null default true,
      requires_approval boolean not null default false,
      approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
      approval_request_id uuid references public.approval_requests(id) on delete set null,
      data jsonb not null default '{}'::jsonb,
      created_by uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint promotions_time_check check (start_at < end_at),
      constraint promotions_discount_check check (
        (discount_mode = 'fixed_total' and fixed_total is not null and fixed_total > 0 and percent_off is null)
        or
        (discount_mode = 'percent_off' and percent_off is not null and percent_off > 0 and percent_off <= 100 and fixed_total is null)
      ),
      constraint promotions_display_original_total_check check (
        display_original_total is null or display_original_total > 0
      ),
      constraint promotions_max_uses_check check (
        max_uses is null or max_uses > 0
      )
    );

    if to_regclass('public.set_updated_at') is not null then
      drop trigger if exists trg_promotions_updated_at on public.promotions;
      create trigger trg_promotions_updated_at
      before update on public.promotions
      for each row execute function public.set_updated_at();
    end if;

    create index if not exists idx_promotions_active_window
      on public.promotions(is_active, start_at, end_at);
    create index if not exists idx_promotions_approval_status
      on public.promotions(approval_status);

    alter table public.promotions enable row level security;
    drop policy if exists promotions_admin_all on public.promotions;
    create policy promotions_admin_all on public.promotions
      for all using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

do $$
begin
  if to_regclass('public.promotion_items') is null then
    create table public.promotion_items (
      id uuid primary key default gen_random_uuid(),
      promotion_id uuid not null references public.promotions(id) on delete cascade,
      item_id text not null references public.menu_items(id) on delete restrict,
      quantity numeric not null check (quantity > 0),
      sort_order int not null default 0,
      created_at timestamptz not null default now(),
      unique (promotion_id, item_id)
    );

    create index if not exists idx_promotion_items_promotion on public.promotion_items(promotion_id, sort_order, created_at);
    create index if not exists idx_promotion_items_item on public.promotion_items(item_id);

    alter table public.promotion_items enable row level security;
    drop policy if exists promotion_items_admin_all on public.promotion_items;
    create policy promotion_items_admin_all on public.promotion_items
      for all using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

do $$
begin
  if to_regclass('public.promotion_usage') is null then
    create table public.promotion_usage (
      id uuid primary key default gen_random_uuid(),
      promotion_id uuid not null references public.promotions(id) on delete restrict,
      promotion_line_id uuid not null,
      order_id uuid references public.orders(id) on delete set null,
      bundle_qty numeric not null default 1 check (bundle_qty > 0),
      channel text not null check (channel in ('online','in_store','pos_offline_sync')),
      warehouse_id uuid references public.warehouses(id) on delete set null,
      snapshot jsonb not null default '{}'::jsonb,
      created_by uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      unique (promotion_line_id)
    );

    create index if not exists idx_promotion_usage_promotion_created on public.promotion_usage(promotion_id, created_at desc);
    create index if not exists idx_promotion_usage_order on public.promotion_usage(order_id);

    alter table public.promotion_usage enable row level security;
    drop policy if exists promotion_usage_admin_all on public.promotion_usage;
    create policy promotion_usage_admin_all on public.promotion_usage
      for all using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

create or replace function public.trg_promotions_lock_after_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used boolean;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.promotion_usage u where u.promotion_id = old.id limit 1) then
      raise exception 'promotion_is_immutable_after_usage';
    end if;
    return old;
  end if;

  v_used := exists (select 1 from public.promotion_usage u where u.promotion_id = old.id limit 1);
  if not v_used then
    return new;
  end if;

  if new.id <> old.id
     or new.name <> old.name
     or new.start_at <> old.start_at
     or new.end_at <> old.end_at
     or new.discount_mode <> old.discount_mode
     or coalesce(new.fixed_total, -1) <> coalesce(old.fixed_total, -1)
     or coalesce(new.percent_off, -1) <> coalesce(old.percent_off, -1)
     or coalesce(new.display_original_total, -1) <> coalesce(old.display_original_total, -1)
     or coalesce(new.max_uses, -1) <> coalesce(old.max_uses, -1)
     or new.stack_policy <> old.stack_policy
     or new.exclusive_with_coupon <> old.exclusive_with_coupon
  then
    raise exception 'promotion_is_immutable_after_usage';
  end if;

  if old.is_active = false and new.is_active = true then
    raise exception 'promotion_cannot_be_reactivated_after_usage';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_promotions_lock_after_usage on public.promotions;
create trigger trg_promotions_lock_after_usage
before update or delete on public.promotions
for each row execute function public.trg_promotions_lock_after_usage();

create or replace function public.trg_promotion_items_lock_after_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo_id uuid;
begin
  v_promo_id := coalesce(old.promotion_id, new.promotion_id);
  if v_promo_id is not null and exists (select 1 from public.promotion_usage u where u.promotion_id = v_promo_id limit 1) then
    raise exception 'promotion_items_are_immutable_after_usage';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_promotion_items_lock_after_usage on public.promotion_items;
create trigger trg_promotion_items_lock_after_usage
before insert or update or delete on public.promotion_items
for each row execute function public.trg_promotion_items_lock_after_usage();

create or replace function public.trg_promotions_enforce_active_window_and_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.is_active then
      if new.approval_status <> 'approved' then
        raise exception 'promotion_requires_approval';
      end if;
      if now() < new.start_at or now() > new.end_at then
        raise exception 'promotion_outside_time_window';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_promotions_enforce_active_window_and_approval on public.promotions;
create trigger trg_promotions_enforce_active_window_and_approval
before insert or update on public.promotions
for each row execute function public.trg_promotions_enforce_active_window_and_approval();

create or replace function public.trg_promotion_usage_enforce_valid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo record;
  v_used_count int;
begin
  select *
  into v_promo
  from public.promotions p
  where p.id = new.promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;

  if not v_promo.is_active then
    raise exception 'promotion_inactive';
  end if;
  if now() < v_promo.start_at or now() > v_promo.end_at then
    raise exception 'promotion_outside_time_window';
  end if;
  if v_promo.approval_status <> 'approved' then
    raise exception 'promotion_requires_approval';
  end if;

  if v_promo.max_uses is not null then
    select count(*)
    into v_used_count
    from public.promotion_usage u
    where u.promotion_id = new.promotion_id;
    if v_used_count >= v_promo.max_uses then
      raise exception 'promotion_usage_limit_reached';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_promotion_usage_enforce_valid on public.promotion_usage;
create trigger trg_promotion_usage_enforce_valid
before insert on public.promotion_usage
for each row execute function public.trg_promotion_usage_enforce_valid();

