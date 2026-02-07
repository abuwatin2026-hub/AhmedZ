do $$
begin
  create or replace function public.trg_forbid_delete_posted_purchase_orders()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if coalesce(old.status, 'draft') <> 'draft' then
      raise exception 'cannot delete non-draft purchase order; create a reversal instead';
    end if;

    if exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = old.id limit 1) then
      raise exception 'cannot delete purchase order with receipts; create a reversal instead';
    end if;

    if exists (
      select 1
      from public.payments p
      where p.reference_table = 'purchase_orders'
        and p.direction = 'out'
        and p.reference_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot delete purchase order with payments; create a reversal instead';
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'purchase_orders'
        and im.reference_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot delete purchase order with inventory movements; create a reversal instead';
    end if;

    return old;
  end;
  $fn$;

  create or replace function public.trg_forbid_delete_posted_expenses()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'expenses'
        and je.source_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot delete posted expense; create a reversal instead';
    end if;

    if exists (
      select 1
      from public.payments p
      where p.reference_table = 'expenses'
        and p.direction = 'out'
        and p.reference_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot delete expense with payments; create a reversal instead';
    end if;

    return old;
  end;
  $fn$;

  create or replace function public.trg_forbid_delete_posted_payroll_runs()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if coalesce(old.status, 'draft') <> 'draft' then
      raise exception 'cannot delete non-draft payroll run; create a reversal instead';
    end if;

    if old.expense_id is not null then
      if exists (
        select 1
        from public.journal_entries je
        where je.source_table = 'expenses'
          and je.source_id = old.expense_id::text
        limit 1
      ) then
        raise exception 'cannot delete payroll run with posted expense; create a reversal instead';
      end if;

      if exists (
        select 1
        from public.payments p
        where p.reference_table = 'expenses'
          and p.direction = 'out'
          and p.reference_id = old.expense_id::text
        limit 1
      ) then
        raise exception 'cannot delete payroll run with payments; create a reversal instead';
      end if;
    end if;

    return old;
  end;
  $fn$;

  create or replace function public.trg_forbid_delete_posted_inventory_movements()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'inventory_movements'
        and je.source_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot delete posted inventory movement; create a reversal instead';
    end if;
    return old;
  end;
  $fn$;

  if to_regclass('public.purchase_orders') is not null then
    drop trigger if exists trg_purchase_orders_forbid_delete_posted on public.purchase_orders;
    create trigger trg_purchase_orders_forbid_delete_posted
    before delete on public.purchase_orders
    for each row execute function public.trg_forbid_delete_posted_purchase_orders();
  end if;

  if to_regclass('public.expenses') is not null then
    drop trigger if exists trg_expenses_forbid_delete_posted on public.expenses;
    create trigger trg_expenses_forbid_delete_posted
    before delete on public.expenses
    for each row execute function public.trg_forbid_delete_posted_expenses();
  end if;

  if to_regclass('public.payroll_runs') is not null then
    drop trigger if exists trg_payroll_runs_forbid_delete_posted on public.payroll_runs;
    create trigger trg_payroll_runs_forbid_delete_posted
    before delete on public.payroll_runs
    for each row execute function public.trg_forbid_delete_posted_payroll_runs();
  end if;

  if to_regclass('public.inventory_movements') is not null then
    drop trigger if exists trg_inventory_movements_forbid_delete_posted on public.inventory_movements;
    create trigger trg_inventory_movements_forbid_delete_posted
    before delete on public.inventory_movements
    for each row execute function public.trg_forbid_delete_posted_inventory_movements();
  end if;
end $$;

notify pgrst, 'reload schema';
