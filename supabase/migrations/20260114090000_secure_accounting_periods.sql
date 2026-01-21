create or replace function public.trg_check_simple_date_closed_period()
returns trigger
language plpgsql
security definer
as $$
declare
  v_col_name text := TG_ARGV[0];
  v_date_val timestamptz;
begin
  -- Check OLD row on DELETE or UPDATE
  if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') then
    execute format('select ($1).%I', v_col_name) using OLD into v_date_val;
    if public.is_in_closed_period(v_date_val) then
      raise exception 'Cannot modify records in a closed accounting period.';
    end if;
  end if;

  -- Check NEW row on INSERT or UPDATE
  if (TG_OP = 'INSERT' or TG_OP = 'UPDATE') then
    execute format('select ($1).%I', v_col_name) using NEW into v_date_val;
    if public.is_in_closed_period(v_date_val) then
      raise exception 'Cannot create or modify records in a closed accounting period.';
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;
create or replace function public.trg_check_order_closed_period()
returns trigger
language plpgsql
security definer
as $$
declare
  v_date timestamptz;
begin
  -- Check OLD row on DELETE or UPDATE
  if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') then
    if OLD.status = 'delivered' then
       -- Try to find delivery date, fallback to updated_at
       v_date := public.order_delivered_at(OLD.id);
       if v_date is null then v_date := OLD.updated_at; end if;
       
       if public.is_in_closed_period(v_date) then
         raise exception 'Cannot modify delivered order in a closed accounting period.';
       end if;
    end if;
  end if;

  -- Check NEW row on UPDATE
  -- If we are updating an order that IS delivered (or becoming delivered with a past date?)
  if (TG_OP = 'UPDATE') then
    if NEW.status = 'delivered' then
       -- If it was already delivered, we checked OLD above.
       -- If it is JUST becoming delivered, the delivery date is NOW (open period), so it's fine.
       -- Unless user manually forces a past updated_at?
       v_date := public.order_delivered_at(NEW.id);
       if v_date is null then v_date := NEW.updated_at; end if;
       
       if public.is_in_closed_period(v_date) then
         raise exception 'Cannot set order to delivered in a closed accounting period.';
       end if;
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;
create or replace function public.trg_check_po_closed_period()
returns trigger
language plpgsql
security definer
as $$
declare
  v_date date;
begin
  -- Check OLD row on DELETE or UPDATE
  if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') then
    if OLD.status = 'completed' then
       v_date := OLD.purchase_date;
       -- purchase_date is DATE. is_in_closed_period takes timestamptz but casts internally or we cast here.
       if public.is_in_closed_period(v_date::timestamptz) then
         raise exception 'Cannot modify completed purchase order in a closed accounting period.';
       end if;
    end if;
  end if;

  -- Check NEW row on UPDATE
  if (TG_OP = 'UPDATE') then
    if NEW.status = 'completed' then
       v_date := NEW.purchase_date;
       if public.is_in_closed_period(v_date::timestamptz) then
         raise exception 'Cannot complete purchase order in a closed accounting period.';
       end if;
    end if;
  end if;

  -- INSERT: If inserting a completed PO directly?
  if (TG_OP = 'INSERT') then
    if NEW.status = 'completed' then
       v_date := NEW.purchase_date;
       if public.is_in_closed_period(v_date::timestamptz) then
         raise exception 'Cannot create completed purchase order in a closed accounting period.';
       end if;
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;
-- Apply Triggers

-- Expenses
drop trigger if exists check_period_expenses on public.expenses;
create trigger check_period_expenses
before insert or update or delete on public.expenses
for each row execute function public.trg_check_simple_date_closed_period('date');
-- Payments
drop trigger if exists check_period_payments on public.payments;
create trigger check_period_payments
before insert or update or delete on public.payments
for each row execute function public.trg_check_simple_date_closed_period('occurred_at');
-- Orders
drop trigger if exists check_period_orders on public.orders;
create trigger check_period_orders
before insert or update or delete on public.orders
for each row execute function public.trg_check_order_closed_period();
-- Purchase Orders
drop trigger if exists check_period_purchase_orders on public.purchase_orders;
create trigger check_period_purchase_orders
before insert or update or delete on public.purchase_orders
for each row execute function public.trg_check_po_closed_period();
-- Inventory Movements
drop trigger if exists check_period_inventory_movements on public.inventory_movements;
create trigger check_period_inventory_movements
before insert or update or delete on public.inventory_movements
for each row execute function public.trg_check_simple_date_closed_period('occurred_at');
create or replace function public.trg_check_shift_closed_period()
returns trigger
language plpgsql
security definer
as $$
declare
  v_date timestamptz;
begin
  -- Check OLD row on DELETE or UPDATE
  if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') then
    if OLD.status = 'closed' then
       v_date := OLD.closed_at;
       if public.is_in_closed_period(v_date) then
         raise exception 'Cannot modify closed shift in a closed accounting period.';
       end if;
    end if;
  end if;
  -- Check NEW row on UPDATE (if closing a shift with past date? unlikely but possible)
  if (TG_OP = 'UPDATE') then
    if NEW.status = 'closed' and NEW.closed_at is not null then
       if public.is_in_closed_period(NEW.closed_at) then
          -- If we are just closing it NOW, closed_at is NOW (open).
          -- If we force a past date, block it.
          raise exception 'Cannot close shift in a closed accounting period.';
       end if;
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;
drop trigger if exists check_period_cash_shifts on public.cash_shifts;
create trigger check_period_cash_shifts
before insert or update or delete on public.cash_shifts
for each row execute function public.trg_check_shift_closed_period();
