do $$
begin
  if to_regclass('public.fx_rates') is not null then
    delete from public.fx_rates where upper(currency_code) <> 'YER';
  end if;
  if to_regclass('public.currencies') is not null then
    delete from public.currencies where upper(code) <> 'YER';
  end if;
exception when undefined_table then
  null;
end $$;

create or replace function public.get_base_currency()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'YER'::text
$$;

create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select 1::numeric
$$;

create or replace function public.trg_force_order_yer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur text;
begin
  v_cur := upper(nullif(btrim(coalesce(new.currency, '')), ''));
  if v_cur is not null and v_cur <> 'YER' then
    raise exception 'currency not supported';
  end if;
  new.currency := 'YER';
  new.fx_rate := 1;
  new.base_total := coalesce(new.total, 0);
  return new;
end;
$$;

create or replace function public.trg_force_payment_yer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur text;
begin
  v_cur := upper(nullif(btrim(coalesce(new.currency, '')), ''));
  if v_cur is not null and v_cur <> 'YER' then
    raise exception 'currency not supported';
  end if;
  new.currency := 'YER';
  new.fx_rate := 1;
  new.base_amount := coalesce(new.amount, 0);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.orders') is not null then
    drop trigger if exists trg_set_order_fx on public.orders;
    drop trigger if exists trg_force_order_yer on public.orders;
    create trigger trg_force_order_yer
    before insert or update on public.orders
    for each row execute function public.trg_force_order_yer();
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if to_regclass('public.payments') is not null then
    drop trigger if exists trg_set_payment_fx on public.payments;
    drop trigger if exists trg_force_payment_yer on public.payments;
    create trigger trg_force_payment_yer
    before insert or update on public.payments
    for each row execute function public.trg_force_payment_yer();
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  update public.orders
  set currency = 'YER',
      fx_rate = 1,
      base_total = coalesce(total, 0)
  where currency is distinct from 'YER'
     or fx_rate is distinct from 1
     or base_total is distinct from coalesce(total, 0);
exception when undefined_table then
  null;
end $$;

do $$
begin
  update public.payments
  set currency = 'YER',
      fx_rate = 1,
      base_amount = coalesce(amount, 0)
  where currency is distinct from 'YER'
     or fx_rate is distinct from 1
     or base_amount is distinct from coalesce(amount, 0);
exception when undefined_table then
  null;
end $$;

do $$
begin
  if to_regclass('public.trg_set_order_fx') is not null then
    drop function if exists public.trg_set_order_fx();
  end if;
  if to_regclass('public.trg_set_payment_fx') is not null then
    drop function if exists public.trg_set_payment_fx();
  end if;
exception when undefined_function then
  null;
end $$;

