drop trigger if exists "trg_import_expenses_post" on "public"."import_expenses";

drop trigger if exists "trg_inventory_movements_purchase_in_no_delete" on "public"."inventory_movements";

drop trigger if exists "trg_item_groups_updated_at" on "public"."item_groups";

drop trigger if exists "trg_orders_require_sale_out_on_delivered" on "public"."orders";

drop policy "accounting_light_entries_admin_only" on "public"."accounting_light_entries";

drop policy "item_groups_select_all" on "public"."item_groups";

drop policy "item_groups_write_admin" on "public"."item_groups";

drop policy "order_events_select_permissions" on "public"."order_events";

drop policy "orders_select_permissions" on "public"."orders";

revoke delete on table "public"."accounting_light_entries" from "anon";

revoke insert on table "public"."accounting_light_entries" from "anon";

revoke references on table "public"."accounting_light_entries" from "anon";

revoke select on table "public"."accounting_light_entries" from "anon";

revoke trigger on table "public"."accounting_light_entries" from "anon";

revoke truncate on table "public"."accounting_light_entries" from "anon";

revoke update on table "public"."accounting_light_entries" from "anon";

revoke delete on table "public"."accounting_light_entries" from "authenticated";

revoke insert on table "public"."accounting_light_entries" from "authenticated";

revoke references on table "public"."accounting_light_entries" from "authenticated";

revoke select on table "public"."accounting_light_entries" from "authenticated";

revoke trigger on table "public"."accounting_light_entries" from "authenticated";

revoke truncate on table "public"."accounting_light_entries" from "authenticated";

revoke update on table "public"."accounting_light_entries" from "authenticated";

revoke delete on table "public"."accounting_light_entries" from "service_role";

revoke insert on table "public"."accounting_light_entries" from "service_role";

revoke references on table "public"."accounting_light_entries" from "service_role";

revoke select on table "public"."accounting_light_entries" from "service_role";

revoke trigger on table "public"."accounting_light_entries" from "service_role";

revoke truncate on table "public"."accounting_light_entries" from "service_role";

revoke update on table "public"."accounting_light_entries" from "service_role";

revoke delete on table "public"."item_groups" from "anon";

revoke insert on table "public"."item_groups" from "anon";

revoke references on table "public"."item_groups" from "anon";

revoke select on table "public"."item_groups" from "anon";

revoke trigger on table "public"."item_groups" from "anon";

revoke truncate on table "public"."item_groups" from "anon";

revoke update on table "public"."item_groups" from "anon";

revoke delete on table "public"."item_groups" from "authenticated";

revoke insert on table "public"."item_groups" from "authenticated";

revoke references on table "public"."item_groups" from "authenticated";

revoke select on table "public"."item_groups" from "authenticated";

revoke trigger on table "public"."item_groups" from "authenticated";

revoke truncate on table "public"."item_groups" from "authenticated";

revoke update on table "public"."item_groups" from "authenticated";

revoke delete on table "public"."item_groups" from "service_role";

revoke insert on table "public"."item_groups" from "service_role";

revoke references on table "public"."item_groups" from "service_role";

revoke select on table "public"."item_groups" from "service_role";

revoke trigger on table "public"."item_groups" from "service_role";

revoke truncate on table "public"."item_groups" from "service_role";

revoke update on table "public"."item_groups" from "service_role";

alter table "public"."accounting_light_entries" drop constraint "accounting_light_entries_created_by_fkey";

alter table "public"."accounting_light_entries" drop constraint "accounting_light_entries_entry_type_check";

alter table "public"."accounting_light_entries" drop constraint "accounting_light_entries_quantity_check";

alter table "public"."import_expenses" drop constraint "import_expenses_payment_method_check";

alter table "public"."inventory_movements" drop constraint "inventory_movements_warehouse_id_fkey";

alter table "public"."item_groups" drop constraint "item_groups_category_key_fkey";

alter table "public"."admin_users" drop constraint "admin_users_role_check";

alter table "public"."import_shipments" drop constraint "import_shipments_status_check";

drop function if exists "public"."cancel_order"(p_order_id uuid, p_reason text, p_occurred_at timestamp with time zone);

drop function if exists "public"."get_item_suggested_sell_price"(p_item_id text, p_warehouse_id uuid, p_cost_per_unit numeric, p_margin_pct numeric);

drop function if exists "public"."post_import_expense"(p_import_expense_id uuid);

drop function if exists "public"."record_import_expense_payment"(p_import_expense_id uuid, p_amount numeric, p_method text, p_occurred_at timestamp with time zone);

drop function if exists "public"."reserve_stock_for_order"(p_items jsonb, p_order_id uuid);

drop function if exists "public"."trg_inventory_movements_purchase_in_no_delete"();

drop function if exists "public"."trg_post_import_expense"();

drop view if exists "public"."v_food_batch_balances";

drop view if exists "public"."v_sellable_products";

alter table "public"."accounting_light_entries" drop constraint "accounting_light_entries_pkey";

alter table "public"."item_groups" drop constraint "item_groups_pkey";

drop index if exists "public"."accounting_light_entries_pkey";

drop index if exists "public"."idx_accounting_light_entries_batch";

drop index if exists "public"."idx_accounting_light_entries_date";

drop index if exists "public"."idx_accounting_light_entries_item";

drop index if exists "public"."idx_accounting_light_entries_wh";

drop index if exists "public"."idx_inventory_movements_warehouse";

drop index if exists "public"."idx_inventory_movements_warehouse_batch";

drop index if exists "public"."idx_inventory_movements_warehouse_item_date";

drop index if exists "public"."idx_item_groups_category_key";

drop index if exists "public"."idx_item_groups_category_key_key";

drop index if exists "public"."idx_menu_items_group_key";

drop index if exists "public"."item_groups_pkey";

drop table "public"."accounting_light_entries";

drop table "public"."item_groups";

alter type "public"."ledger_account_code" rename to "ledger_account_code__old_version_to_be_dropped";

create type "public"."ledger_account_code" as enum ('Sales_Revenue', 'Accounts_Receivable_COD', 'Cash_In_Transit', 'Cash_On_Hand');


  create table "public"."purchase_receipt_expenses" (
    "id" uuid not null default gen_random_uuid(),
    "receipt_id" uuid not null,
    "description" text not null,
    "amount" numeric not null,
    "currency" text default 'SAR'::text,
    "supplier_id" uuid,
    "allocation_method" text default 'value'::text,
    "created_at" timestamp with time zone default now(),
    "created_by" uuid
      );



  create table "public"."reservation_lines" (
    "id" uuid not null default gen_random_uuid(),
    "order_id" uuid not null,
    "item_id" text not null,
    "warehouse_id" uuid not null,
    "batch_id" uuid,
    "quantity" numeric not null,
    "expiry_date" date,
    "status" text not null default 'reserved'::text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."reservation_lines" enable row level security;

alter table "public"."ledger_lines" alter column account type "public"."ledger_account_code" using account::text::"public"."ledger_account_code";

drop type "public"."ledger_account_code__old_version_to_be_dropped";

alter table "public"."batches" alter column "warehouse_id" set not null;

alter table "public"."import_expenses" drop column "payment_method";

alter table "public"."inventory_movements" alter column "warehouse_id" set not null;

alter table "public"."menu_items" drop column "group_key";

alter table "public"."orders" alter column "warehouse_id" set not null;

alter table "public"."purchase_orders" alter column "warehouse_id" set not null;

alter table "public"."purchase_receipt_items" add column "base_unit_cost" numeric default 0;

alter table "public"."purchase_receipt_items" add column "other_cost" numeric not null default 0;

alter table "public"."purchase_receipts" alter column "warehouse_id" set not null;

alter table "public"."stock_management" alter column "warehouse_id" set not null;

alter table "public"."warehouse_transfer_items" drop column "batch_id";

CREATE INDEX idx_reservation_lines_batch ON public.reservation_lines USING btree (batch_id);

CREATE INDEX idx_reservation_lines_item_warehouse ON public.reservation_lines USING btree (item_id, warehouse_id);

CREATE INDEX idx_reservation_lines_order ON public.reservation_lines USING btree (order_id);

CREATE UNIQUE INDEX purchase_receipt_expenses_pkey ON public.purchase_receipt_expenses USING btree (id);

CREATE UNIQUE INDEX reservation_lines_pkey ON public.reservation_lines USING btree (id);

CREATE UNIQUE INDEX ux_inventory_movements_sale_out_batch ON public.inventory_movements USING btree (reference_table, reference_id, movement_type, item_id, warehouse_id, batch_id) WHERE ((movement_type = 'sale_out'::text) AND (batch_id IS NOT NULL));

CREATE UNIQUE INDEX ux_inventory_movements_sale_out_nobatch ON public.inventory_movements USING btree (reference_table, reference_id, movement_type, item_id, warehouse_id) WHERE ((movement_type = 'sale_out'::text) AND (batch_id IS NULL));

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_pkey" PRIMARY KEY using index "purchase_receipt_expenses_pkey";

alter table "public"."reservation_lines" add constraint "reservation_lines_pkey" PRIMARY KEY using index "reservation_lines_pkey";

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_allocation_method_check" CHECK ((allocation_method = ANY (ARRAY['value'::text, 'quantity'::text, 'weight'::text, 'manual'::text]))) not valid;

alter table "public"."purchase_receipt_expenses" validate constraint "purchase_receipt_expenses_allocation_method_check";

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_amount_check" CHECK ((amount >= (0)::numeric)) not valid;

alter table "public"."purchase_receipt_expenses" validate constraint "purchase_receipt_expenses_amount_check";

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."purchase_receipt_expenses" validate constraint "purchase_receipt_expenses_created_by_fkey";

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES public.purchase_receipts(id) ON DELETE CASCADE not valid;

alter table "public"."purchase_receipt_expenses" validate constraint "purchase_receipt_expenses_receipt_id_fkey";

alter table "public"."purchase_receipt_expenses" add constraint "purchase_receipt_expenses_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) not valid;

alter table "public"."purchase_receipt_expenses" validate constraint "purchase_receipt_expenses_supplier_id_fkey";

alter table "public"."reservation_lines" add constraint "reservation_lines_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public.batches(id) not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_batch_id_fkey";

alter table "public"."reservation_lines" add constraint "reservation_lines_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.menu_items(id) not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_item_id_fkey";

alter table "public"."reservation_lines" add constraint "reservation_lines_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_order_id_fkey";

alter table "public"."reservation_lines" add constraint "reservation_lines_quantity_check" CHECK ((quantity > (0)::numeric)) not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_quantity_check";

alter table "public"."reservation_lines" add constraint "reservation_lines_status_check" CHECK ((status = ANY (ARRAY['reserved'::text, 'released'::text, 'consumed'::text]))) not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_status_check";

alter table "public"."reservation_lines" add constraint "reservation_lines_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) not valid;

alter table "public"."reservation_lines" validate constraint "reservation_lines_warehouse_id_fkey";

alter table "public"."admin_users" add constraint "admin_users_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'employee'::text, 'accountant'::text, 'cashier'::text, 'delivery'::text]))) not valid;

alter table "public"."admin_users" validate constraint "admin_users_role_check";

alter table "public"."import_shipments" add constraint "import_shipments_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'ordered'::text, 'shipped'::text, 'at_customs'::text, 'cleared'::text, 'delivered'::text, 'cancelled'::text]))) not valid;

alter table "public"."import_shipments" validate constraint "import_shipments_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.balance_sheet(p_as_of date)
 RETURNS TABLE(assets numeric, liabilities numeric, equity numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  with tb as (
    select *
    from public.trial_balance(null, p_as_of)
  )
  select
    coalesce(sum(case when tb.account_type = 'asset' then (tb.debit - tb.credit) else 0 end), 0) as assets,
    coalesce(sum(case when tb.account_type = 'liability' then (tb.credit - tb.debit) else 0 end), 0) as liabilities,
    coalesce(sum(case when tb.account_type = 'equity' then (tb.credit - tb.debit) else 0 end), 0) as equity
  from tb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_local_landed_cost(p_receipt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receipt record;
  v_expenses_total numeric;
  v_items_total_value numeric;
  v_items_total_qty numeric;
  v_item record;
  v_allocated_cost numeric;
  v_new_unit_cost numeric;
  v_batch_id uuid;
  v_po_ref text;
begin
  -- Get Receipt Info
  select pr.*, po.reference_number as po_ref
  into v_receipt
  from public.purchase_receipts pr
  join public.purchase_orders po on po.id = pr.purchase_order_id
  where pr.id = p_receipt_id;

  if not found then raise exception 'Receipt not found'; end if;
  v_po_ref := v_receipt.po_ref;

  -- Sum Expenses
  select coalesce(sum(amount), 0) into v_expenses_total
  from public.purchase_receipt_expenses
  where receipt_id = p_receipt_id;

  -- Get Totals for Allocation
  select 
    sum(quantity * base_unit_cost),
    sum(quantity)
  into v_items_total_value, v_items_total_qty
  from public.purchase_receipt_items
  where receipt_id = p_receipt_id;

  if v_items_total_value = 0 then v_items_total_value := 1; end if; -- Avoid div by zero
  if v_items_total_qty = 0 then v_items_total_qty := 1; end if;

  -- Loop Items and Update
  for v_item in
    select * from public.purchase_receipt_items where receipt_id = p_receipt_id
  loop
    -- Calculate allocated expense
    -- Currently simple 'value' based allocation is implemented
    -- (ItemValue / TotalValue) * TotalExpenses
    v_allocated_cost := ((v_item.quantity * v_item.base_unit_cost) / v_items_total_value) * v_expenses_total;
    
    -- Cost per unit
    if v_item.quantity > 0 then
      v_new_unit_cost := v_item.base_unit_cost + (v_allocated_cost / v_item.quantity);
    else
      v_new_unit_cost := v_item.base_unit_cost;
    end if;

    -- Update Receipt Item
    update public.purchase_receipt_items
    set unit_cost = v_new_unit_cost,
        total_cost = (quantity * v_new_unit_cost)
    where id = v_item.id;

    -- Find Linked Inventory Movement and Batch
    -- We assume 1-to-1 link between receipt item and 'purchase_in' movement for this receipt
    declare
      v_im_id uuid;
      v_curr_batch_id uuid;
    begin
       select id, batch_id into v_im_id, v_curr_batch_id
       from public.inventory_movements
       where reference_table = 'purchase_receipts'
         and reference_id = p_receipt_id::text
         and item_id::text = v_item.item_id
         and movement_type = 'purchase_in'
       limit 1;
       
       if v_im_id is not null then
          -- Update Movement
          update public.inventory_movements
          set unit_cost = v_new_unit_cost,
              total_cost = (quantity * v_new_unit_cost),
              -- Store split for accounting
              data = jsonb_set(
                coalesce(data, '{}'::jsonb),
                '{fob_total}',
                to_jsonb(v_item.quantity * v_item.base_unit_cost)
              )
          where id = v_im_id;
          
          -- Trigger Accounting
          perform public.post_inventory_movement(v_im_id);
          
          -- Update Batch
          if v_curr_batch_id is not null then
             update public.batches
             set unit_cost = v_new_unit_cost,
                 updated_at = now()
             where id = v_curr_batch_id;
             
             -- Fix Retroactive COGS
             perform public.fix_retroactive_cogs(
               v_curr_batch_id,
               v_new_unit_cost,
               'purchase_receipts',
               p_receipt_id::text,
               v_po_ref
             );
          end if;
       end if;
    end;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_order(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := (p_payload->>'order_id')::uuid;

  UPDATE orders
  SET status = 'cancelled'
  WHERE id = v_order_id;

  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_delivery_v2(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fix_retroactive_cogs(p_batch_id uuid, p_new_unit_cost numeric, p_source_table text, p_source_id text, p_ref_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale_mv record;
  v_cost_diff numeric;
  v_adjust_total numeric;
  v_adjust_id uuid;
  v_old_cost numeric;
begin
  -- Get current batch cost (which is the OLD cost before this update, or we need to pass old cost?)
  -- Actually, we can get the old cost from the batch itself BEFORE we update it? 
  -- Or the caller updates the batch and then calls this?
  -- If the caller updates the batch, we can't get the old cost easily unless passed.
  -- But we can infer it from the sale movements.
  
  -- Let's iterate over sale movements and check their recorded unit_cost.
  -- If it differs from p_new_unit_cost, we adjust.
  
  for v_sale_mv in
    select *
    from public.inventory_movements
    where batch_id = p_batch_id
      and movement_type = 'sale_out'
  loop
     v_old_cost := v_sale_mv.unit_cost;
     v_cost_diff := p_new_unit_cost - v_old_cost;
     
     if v_cost_diff <> 0 then
        v_adjust_total := v_sale_mv.quantity * v_cost_diff;
        
        -- Create Journal Entry
        insert into public.journal_entries(
          entry_date,
          memo,
          source_table,
          source_id,
          source_event,
          created_by
        )
        values (
          now(),
          concat('COGS Adjustment (', p_source_table, ' ', p_ref_number, ')'),
          p_source_table,
          p_source_id,
          concat('cogs_adj_', v_sale_mv.id),
          auth.uid()
        )
        returning id into v_adjust_id;

        -- Entries:
        -- Cost Increased (Diff > 0): Dr COGS, Cr Inventory
        -- Cost Decreased (Diff < 0): Dr Inventory, Cr COGS (Negative values handle this naturally in Dr/Cr logic usually, but here we explicitly set debit/credit)
        
        if v_adjust_total > 0 then
           -- Cost went UP. We need more Expense (Dr COGS) and reduce Inventory Value (Cr Inventory?? No wait)
           -- Original Sale: Dr COGS 100, Cr Inventory 100.
           -- New Cost should be 120.
           -- We need extra Dr COGS 20.
           -- And Cr Inventory 20.
           -- Why Cr Inventory? Because Inventory Account tracks the ASSET value.
           -- When we sold, we reduced Asset by 100. We SHOULD have reduced by 120.
           -- So we still have 20 "too much" in the Asset account (conceptually) related to this item?
           -- No, the Asset account is reduced by the CREDITS.
           -- We credited 100. We should have credited 120.
           -- So we need to Credit 20 more. Correct.
           
           insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
           values
             (v_adjust_id, public.get_account_id_by_code('5010'), v_adjust_total, 0, 'COGS Adjustment (Increase)'),
             (v_adjust_id, public.get_account_id_by_code('1410'), 0, v_adjust_total, 'Inventory Value Adjustment');
             
        else
           -- Cost went DOWN (v_adjust_total is negative).
           -- We credited 120. Should have credited 100.
           -- We credited TOO MUCH. We need to Debit Inventory 20.
           -- And Credit COGS 20.
           
           insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
           values
             (v_adjust_id, public.get_account_id_by_code('1410'), abs(v_adjust_total), 0, 'Inventory Value Adjustment'),
             (v_adjust_id, public.get_account_id_by_code('5010'), 0, abs(v_adjust_total), 'COGS Adjustment (Decrease)');
        end if;

        -- Update the movement history
        update public.inventory_movements
        set unit_cost = p_new_unit_cost,
            total_cost = (quantity * p_new_unit_cost)
        where id = v_sale_mv.id;
        
        -- Update order_item_cogs
        update public.order_item_cogs
        set unit_cost = p_new_unit_cost,
            total_cost = (quantity * p_new_unit_cost)
        where order_id::text = v_sale_mv.reference_id
          and item_id = v_sale_mv.item_id::text;
     end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.general_ledger(p_account_code text, p_start date, p_end date)
 RETURNS TABLE(entry_date date, journal_entry_id uuid, memo text, source_table text, source_id text, source_event text, debit numeric, credit numeric, amount numeric, running_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  with acct as (
    select coa.id, coa.normal_balance
    from public.chart_of_accounts coa
    where coa.code = p_account_code
    limit 1
  ),
  opening as (
    select coalesce(sum(
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end
    ), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where p_start is not null
      and je.entry_date::date < p_start
  ),
  lines as (
    select
      je.entry_date::date as entry_date,
      je.id as journal_entry_id,
      je.memo,
      je.source_table,
      je.source_id,
      je.source_event,
      jl.debit,
      jl.credit,
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end as amount,
      je.created_at as entry_created_at,
      jl.created_at as line_created_at
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
  )
  select
    l.entry_date,
    l.journal_entry_id,
    l.memo,
    l.source_table,
    l.source_id,
    l.source_event,
    l.debit,
    l.credit,
    l.amount,
    (select opening_balance from opening)
      + sum(l.amount) over (order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id) as running_balance
  from lines l
  order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.income_statement(p_start date, p_end date)
 RETURNS TABLE(income numeric, expenses numeric, net_profit numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  with tb as (
    select *
    from public.trial_balance(p_start, p_end)
  )
  select
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income,
    coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as net_profit
  from tb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_all_warehouses_stock()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh record;
BEGIN
  IF to_regclass('public.warehouses') IS NULL THEN
    RETURN;
  END IF;
  IF to_regprocedure('public.recalculate_warehouse_stock(uuid)') IS NULL THEN
    RETURN;
  END IF;
  FOR v_wh IN SELECT id FROM public.warehouses WHERE is_active = true
  LOOP
    PERFORM public.recalculate_warehouse_stock(v_wh.id);
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_stock_item(p_item_id_text text, p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_in numeric;
    v_total_out numeric;
    v_reserved numeric;
    v_item_uuid uuid;
BEGIN
    -- 1. Calculate Movements
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_in
    FROM public.inventory_movements
    WHERE item_id = p_item_id_text
      AND warehouse_id = p_warehouse_id
      AND movement_type IN ('purchase_in', 'adjust_in', 'return_in');

    SELECT COALESCE(SUM(quantity), 0) INTO v_total_out
    FROM public.inventory_movements
    WHERE item_id = p_item_id_text
      AND warehouse_id = p_warehouse_id
      AND movement_type IN ('sale_out', 'adjust_out', 'return_out', 'wastage_out');

    -- 2. Calculate Reserved
    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM public.reservation_lines
    WHERE item_id = p_item_id_text
      AND warehouse_id = p_warehouse_id
      AND status = 'reserved';

    -- 3. Update Stock Management (Safe Cast)
    UPDATE public.stock_management
    SET available_quantity = (v_total_in - v_total_out),
        reserved_quantity = v_reserved,
        last_updated = now()
    WHERE item_id::text = p_item_id_text AND warehouse_id = p_warehouse_id;
    
    IF NOT FOUND THEN
         -- Try to cast to UUID for Insert if needed
         BEGIN
             v_item_uuid := p_item_id_text::uuid;
         EXCEPTION WHEN OTHERS THEN
             v_item_uuid := NULL;
         END;

         BEGIN
             IF v_item_uuid IS NOT NULL THEN
                 INSERT INTO public.stock_management (item_id, warehouse_id, available_quantity, reserved_quantity, last_updated)
                 VALUES (v_item_uuid, p_warehouse_id, (v_total_in - v_total_out), v_reserved, now());
             ELSE
                 -- Use raw text if column allows (or implicit cast)
                 -- If column is UUID, this will fail for non-uuid text, which is expected.
                 -- We assume item_id is usually valid UUID if it's in inventory_movements.
                  INSERT INTO public.stock_management (item_id, warehouse_id, available_quantity, reserved_quantity, last_updated)
                  VALUES (p_item_id_text::uuid, p_warehouse_id, (v_total_in - v_total_out), v_reserved, now());
             END IF;
         EXCEPTION WHEN OTHERS THEN
             -- Last resort: try inserting as text (if column is text)
             -- We use dynamic SQL to avoid parser errors if column is UUID
             -- Actually, simpler to just raise warning or ignore if insert fails.
             RAISE WARNING 'Could not insert stock record for item %: %', p_item_id_text, SQLERRM;
         END;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_warehouse_stock(p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_item record;
BEGIN
    FOR v_item IN SELECT DISTINCT item_id FROM public.inventory_movements WHERE warehouse_id = p_warehouse_id
    LOOP
        PERFORM public.recalculate_stock_item(v_item.item_id, p_warehouse_id);
    END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_reserved_stock_for_order(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- منطق الإرجاع
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_reservation_to_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.stock_management
    SET reserved_quantity = reserved_quantity + NEW.quantity,
        last_updated = NOW()
    WHERE item_id::text = NEW.item_id 
      AND warehouse_id = NEW.warehouse_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.stock_management
    SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity),
        last_updated = NOW()
    WHERE item_id::text = OLD.item_id 
      AND warehouse_id = OLD.warehouse_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Handle quantity change
    IF OLD.quantity <> NEW.quantity THEN
      UPDATE public.stock_management
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity + NEW.quantity),
          last_updated = NOW()
      WHERE item_id::text = NEW.item_id 
        AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trial_balance(p_start date, p_end date)
 RETURNS TABLE(account_code text, account_name text, account_type text, normal_balance text, debit numeric, credit numeric, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(jl.debit), 0) as debit,
    coalesce(sum(jl.credit), 0) as credit,
    coalesce(sum(jl.debit - jl.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and (p_start is null or je.entry_date::date >= p_start)
   and (p_end is null or je.entry_date::date <= p_end)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._apply_ar_open_item_credit(p_invoice_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amt numeric := greatest(coalesce(p_amount, 0), 0);
  v_new_open numeric;
begin
  if p_invoice_id is null or v_amt <= 0 then
    return;
  end if;

  update public.ar_open_items
  set
    open_balance = greatest(0, open_balance - v_amt),
    status = case when greatest(0, open_balance - v_amt) = 0 then 'closed' else status end,
    closed_at = case when greatest(0, open_balance - v_amt) = 0 then now() else closed_at end
  where invoice_id = p_invoice_id
    and status = 'open';
end;
$function$
;

CREATE OR REPLACE FUNCTION public._assign_po_number(p_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare
    v_seq bigint;
    v_date date;
  begin
    v_date := coalesce(p_date, current_date);
    v_seq := nextval('public.purchase_order_number_seq'::regclass);
    return concat('PO-', to_char(v_date, 'YYMMDD'), '-', lpad(v_seq::text, 6, '0'));
  end
  $function$
;

CREATE OR REPLACE FUNCTION public._compute_promotion_price_only(p_promotion_id uuid, p_customer_id uuid, p_bundle_qty numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bundle_qty numeric;
  v_promo record;
  v_item record;
  v_required_qty numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_items jsonb := '[]'::jsonb;
  v_original_total numeric := 0;
  v_final_total numeric := 0;
  v_promo_expense numeric := 0;
  v_currency text;
begin
  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;

  v_bundle_qty := coalesce(p_bundle_qty, 1);
  if v_bundle_qty <= 0 then
    v_bundle_qty := 1;
  end if;

  select * into v_promo
  from public.promotions p
  where p.id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;

  v_currency := public.get_base_currency();

  for v_item in
    select pi.item_id, pi.quantity
    from public.promotion_items pi
    where pi.promotion_id = p_promotion_id
    order by pi.sort_order asc, pi.created_at asc, pi.id asc
  loop
    v_required_qty := public._money_round(coalesce(v_item.quantity, 0) * v_bundle_qty, 6);
    if v_required_qty <= 0 then
      continue;
    end if;

    v_unit_price := public.get_item_price_with_discount(v_item.item_id, p_customer_id, v_required_qty);
    v_unit_price := public._money_round(v_unit_price);
    v_line_gross := public._money_round(v_unit_price * v_required_qty);

    v_items := v_items || jsonb_build_object(
      'itemId', v_item.item_id,
      'quantity', v_required_qty,
      'unitPrice', v_unit_price,
      'grossTotal', v_line_gross
    );

    v_original_total := v_original_total + v_line_gross;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'promotion_has_no_items';
  end if;

  v_original_total := public._money_round(v_original_total);

  if v_promo.discount_mode = 'fixed_total' then
    v_final_total := public._money_round(coalesce(v_promo.fixed_total, 0) * v_bundle_qty);
  else
    v_final_total := public._money_round(v_original_total * (1 - (coalesce(v_promo.percent_off, 0) / 100.0)));
  end if;

  v_final_total := greatest(0, least(v_final_total, v_original_total));
  v_promo_expense := public._money_round(v_original_total - v_final_total);

  return jsonb_build_object(
    'promotionId', v_promo.id::text,
    'name', v_promo.name,
    'startAt', v_promo.start_at,
    'endAt', v_promo.end_at,
    'bundleQty', public._money_round(v_bundle_qty, 6),
    'currency', v_currency,
    'displayOriginalTotal', v_promo.display_original_total,
    'computedOriginalTotal', v_original_total,
    'finalTotal', v_final_total,
    'promotionExpense', v_promo_expense,
    'items', v_items
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public._compute_promotion_snapshot(p_promotion_id uuid, p_customer_id uuid, p_warehouse_id uuid, p_bundle_qty numeric, p_coupon_code text, p_require_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_bundle_qty numeric;
  v_coupon_code text;
  v_promo record;
  v_item record;
  v_item_input jsonb;
  v_required_qty numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_items jsonb := '[]'::jsonb;
  v_original_total numeric := 0;
  v_final_total numeric := 0;
  v_promo_expense numeric := 0;
  v_alloc jsonb := '[]'::jsonb;
  v_alloc_item jsonb;
  v_alloc_total_gross numeric := 0;
  v_gross_share numeric;
  v_alloc_rev numeric;
  v_alloc_rev_sum numeric := 0;
  v_now timestamptz := now();
  v_stock_available numeric;
  v_stock_reserved numeric;
begin
  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;

  v_customer_id := p_customer_id;
  v_warehouse_id := p_warehouse_id;
  if v_warehouse_id is null then
    v_warehouse_id := public._resolve_default_warehouse_id();
  end if;

  v_bundle_qty := coalesce(p_bundle_qty, 1);
  if v_bundle_qty <= 0 then
    v_bundle_qty := 1;
  end if;

  v_coupon_code := nullif(btrim(coalesce(p_coupon_code, '')), '');

  select *
  into v_promo
  from public.promotions p
  where p.id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;

  if p_require_active then
    if not v_promo.is_active then
      raise exception 'promotion_inactive';
    end if;
    if v_promo.approval_status <> 'approved' then
      raise exception 'promotion_requires_approval';
    end if;
    if v_now < v_promo.start_at or v_now > v_promo.end_at then
      raise exception 'promotion_outside_time_window';
    end if;
  end if;

  if v_promo.exclusive_with_coupon and v_coupon_code is not null then
    raise exception 'promotion_coupon_conflict';
  end if;

  for v_item in
    select
      pi.item_id,
      pi.quantity,
      coalesce(mi.is_food, false) as is_food
    from public.promotion_items pi
    join public.menu_items mi on mi.id = pi.item_id
    where pi.promotion_id = p_promotion_id
    order by pi.sort_order asc, pi.created_at asc, pi.id asc
  loop
    v_required_qty := public._money_round(coalesce(v_item.quantity, 0) * v_bundle_qty, 6);
    if v_required_qty <= 0 then
      continue;
    end if;

    if not v_item.is_food then
      select coalesce(sm.available_quantity, 0), coalesce(sm.reserved_quantity, 0)
      into v_stock_available, v_stock_reserved
      from public.stock_management sm
      where sm.item_id::text = v_item.item_id
        and sm.warehouse_id = v_warehouse_id;

      if (coalesce(v_stock_available, 0) - coalesce(v_stock_reserved, 0)) + 1e-9 < v_required_qty then
        raise exception 'Insufficient stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    else
      select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0)), 0)
      into v_stock_available
      from public.batches b
      where b.item_id = v_item.item_id
        and b.warehouse_id = v_warehouse_id
        and (b.expiry_date is null or b.expiry_date >= current_date);

      if coalesce(v_stock_available, 0) + 1e-9 < v_required_qty then
        raise exception 'Insufficient FEFO stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    end if;

    v_unit_price := public.get_item_price_with_discount(v_item.item_id, v_customer_id, v_required_qty);
    v_unit_price := public._money_round(v_unit_price);
    v_line_gross := public._money_round(v_unit_price * v_required_qty);

    v_items := v_items || jsonb_build_object(
      'itemId', v_item.item_id,
      'quantity', v_required_qty,
      'unitPrice', v_unit_price,
      'grossTotal', v_line_gross
    );

    v_original_total := v_original_total + v_line_gross;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'promotion_has_no_items';
  end if;

  v_original_total := public._money_round(v_original_total);

  if v_promo.discount_mode = 'fixed_total' then
    v_final_total := public._money_round(coalesce(v_promo.fixed_total, 0) * v_bundle_qty);
  else
    v_final_total := public._money_round(v_original_total * (1 - (coalesce(v_promo.percent_off, 0) / 100.0)));
  end if;

  v_final_total := greatest(0, least(v_final_total, v_original_total));
  v_promo_expense := public._money_round(v_original_total - v_final_total);

  v_alloc_total_gross := greatest(v_original_total, 0);
  v_alloc_rev_sum := 0;

  for v_item_input in
    select value from jsonb_array_elements(v_items)
  loop
    v_line_gross := coalesce(nullif((v_item_input->>'grossTotal')::numeric, null), 0);
    if v_alloc_total_gross > 0 then
      v_gross_share := greatest(0, v_line_gross) / v_alloc_total_gross;
    else
      v_gross_share := 0;
    end if;
    v_alloc_rev := public._money_round(v_original_total * v_gross_share);
    v_alloc_rev_sum := v_alloc_rev_sum + v_alloc_rev;

    v_alloc_item := jsonb_build_object(
      'itemId', v_item_input->>'itemId',
      'quantity', coalesce(nullif((v_item_input->>'quantity')::numeric, null), 0),
      'unitPrice', coalesce(nullif((v_item_input->>'unitPrice')::numeric, null), 0),
      'grossTotal', v_line_gross,
      'allocatedRevenue', v_alloc_rev,
      'allocatedRevenuePct', v_gross_share
    );
    v_alloc := v_alloc || v_alloc_item;
  end loop;

  if abs(v_alloc_rev_sum - v_original_total) > 0.02 and jsonb_array_length(v_alloc) > 0 then
    v_alloc_item := v_alloc->(jsonb_array_length(v_alloc) - 1);
    v_alloc_item := jsonb_set(
      v_alloc_item,
      '{allocatedRevenue}',
      to_jsonb(public._money_round(coalesce(nullif((v_alloc_item->>'allocatedRevenue')::numeric, null), 0) + (v_original_total - v_alloc_rev_sum))),
      true
    );
    v_alloc := jsonb_set(v_alloc, array[(jsonb_array_length(v_alloc) - 1)::text], v_alloc_item, true);
  end if;

  return jsonb_build_object(
    'promotionId', v_promo.id::text,
    'name', v_promo.name,
    'startAt', v_promo.start_at,
    'endAt', v_promo.end_at,
    'bundleQty', public._money_round(v_bundle_qty, 6),
    'displayOriginalTotal', v_promo.display_original_total,
    'computedOriginalTotal', v_original_total,
    'finalTotal', v_final_total,
    'promotionExpense', v_promo_expense,
    'items', v_items,
    'revenueAllocation', v_alloc,
    'warehouseId', v_warehouse_id::text,
    'customerId', case when v_customer_id is null then null else v_customer_id::text end,
    'appliedAt', v_now
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public._driver_ledger_next_balance(p_driver_id uuid, p_debit numeric, p_credit numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev numeric := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_driver_id::text, 0));
  SELECT dl.balance_after
  INTO v_prev
  FROM public.driver_ledger dl
  WHERE dl.driver_id = p_driver_id
  ORDER BY dl.occurred_at DESC, dl.created_at DESC, dl.id DESC
  LIMIT 1;
  RETURN coalesce(v_prev, 0) + coalesce(p_debit, 0) - coalesce(p_credit, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public._extract_stock_items_from_order_data(p_order_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_items jsonb := '[]'::jsonb;
  v_it jsonb;
  v_line jsonb;
  v_pi jsonb;
  v_item_id text;
  v_unit text;
  v_qty numeric;
begin
  if p_order_data is null then
    return '[]'::jsonb;
  end if;

  if jsonb_typeof(p_order_data->'items') = 'array' then
    for v_it in select value from jsonb_array_elements(p_order_data->'items')
    loop
      v_item_id := nullif(btrim(coalesce(v_it->>'itemId', v_it->>'id', v_it->>'menuItemId')), '');
      v_unit := lower(coalesce(nullif(v_it->>'unitType',''), nullif(v_it->>'unit',''), 'piece'));
      if v_unit in ('kg','gram') then
        v_qty := coalesce(nullif((v_it->>'weight')::numeric, null), nullif((v_it->>'quantity')::numeric, null), 0);
      else
        v_qty := coalesce(nullif((v_it->>'quantity')::numeric, null), 0);
      end if;
      if v_item_id is null or v_qty <= 0 then
        continue;
      end if;
      v_items := v_items || jsonb_build_object('itemId', v_item_id, 'quantity', v_qty);
    end loop;
  end if;

  if jsonb_typeof(p_order_data->'promotionLines') = 'array' then
    for v_line in select value from jsonb_array_elements(p_order_data->'promotionLines')
    loop
      for v_pi in select value from jsonb_array_elements(coalesce(v_line->'items', '[]'::jsonb))
      loop
        v_item_id := nullif(btrim(coalesce(v_pi->>'itemId', v_pi->>'id')), '');
        v_qty := coalesce(nullif((v_pi->>'quantity')::numeric, null), 0);
        if v_item_id is null or v_qty <= 0 then
          continue;
        end if;
        v_items := v_items || jsonb_build_object('itemId', v_item_id, 'quantity', v_qty);
      end loop;
    end loop;
  end if;

  return public._merge_stock_items(v_items);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._is_cod_delivery_order(p_order jsonb, p_delivery_zone_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(nullif(p_order->>'paymentMethod',''), '') = 'cash'
    and coalesce(nullif(p_order->>'orderSource',''), '') <> 'in_store'
    and p_delivery_zone_id is not null
$function$
;

CREATE OR REPLACE FUNCTION public._merge_stock_items(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_map jsonb := '{}'::jsonb;
  v_item_id text;
  v_qty numeric;
  v_result jsonb := '[]'::jsonb;
  v_key text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif((v_item->>'quantity')::numeric, null), 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;
    v_map := jsonb_set(
      v_map,
      array[v_item_id],
      to_jsonb(coalesce(nullif((v_map->>v_item_id)::numeric, null), 0) + v_qty),
      true
    );
  end loop;

  for v_key in select key from jsonb_each(v_map)
  loop
    v_result := v_result || jsonb_build_object('itemId', v_key, 'quantity', (v_map->>v_key)::numeric);
  end loop;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._money_round(p_value numeric, p_scale integer DEFAULT 2)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
begin
  return round(coalesce(p_value, 0), coalesce(p_scale, 2));
end;
$function$
;

CREATE OR REPLACE FUNCTION public._resolve_batch_sale_failure_reason(p_item_id text, p_warehouse_id uuid, p_quantity numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_total_released numeric := 0;
  v_has_nonexpired boolean := false;
  v_has_nonexpired_unreleased boolean := false;
begin
  if p_item_id is null or btrim(p_item_id) = '' or p_warehouse_id is null then
    return 'NO_VALID_BATCH';
  end if;
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
  ) into v_has_nonexpired;

  if not v_has_nonexpired then
    return 'NO_VALID_BATCH';
  end if;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      and coalesce(b.qc_status,'released') <> 'released'
  ) into v_has_nonexpired_unreleased;

  if v_has_nonexpired_unreleased then
    return 'BATCH_NOT_RELEASED';
  end if;

  select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
  into v_total_released
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and coalesce(b.qc_status,'released') = 'released';

  if v_total_released + 1e-9 < v_qty then
    return 'INSUFFICIENT_BATCH_QUANTITY';
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._resolve_default_admin_warehouse_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.id
  from public.warehouses w
  where w.is_active = true
  order by case when upper(coalesce(w.code,'')) = 'MAIN' then 0 else 1 end,
           w.created_at asc,
           w.code asc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public._resolve_default_min_margin_pct(p_item_id text, p_warehouse_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._resolve_default_warehouse_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_warehouse_id uuid;
begin
  select w.id
  into v_warehouse_id
  from public.warehouses w
  where w.is_active = true
  order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
  limit 1;

  if v_warehouse_id is null then
    raise exception 'No active warehouse found';
  end if;
  return v_warehouse_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._resolve_open_shift_for_cash(p_operator uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift_id uuid;
begin
  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = p_operator
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  return v_shift_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._sync_order_terms_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
      v_terms text;
      v_net_days integer;
      v_due date;
      v_due_text text;
      v_basis timestamptz;
    begin
      v_terms := nullif(trim(coalesce(new.data->>'invoiceTerms','')), '');
      if v_terms is null then
        if coalesce((new.data->>'isCreditSale')::boolean, false) or coalesce(new.data->>'paymentMethod','') = 'ar' then
          v_terms := 'credit';
        else
          v_terms := 'cash';
        end if;
      end if;
      if v_terms <> 'credit' then
        v_terms := 'cash';
      end if;

      v_net_days := 0;
      begin
        v_net_days := greatest(0, coalesce(nullif((new.data->>'netDays')::int, 0), (new.data->>'creditDays')::int, new.net_days, 0));
      exception when others then
        v_net_days := greatest(0, coalesce(new.net_days, 0));
      end;

      v_due_text := nullif(trim(coalesce(new.data->>'dueDate','')), '');
      v_due := null;
      if v_due_text is not null then
        begin
          v_due := v_due_text::date;
        exception when others then
          v_due := null;
        end;
      end if;

      if v_due is null then
        begin
          v_basis := nullif(trim(coalesce(new.data->>'invoiceIssuedAt','')), '')::timestamptz;
        exception when others then
          v_basis := null;
        end;
        if v_basis is null then
          begin
            v_basis := nullif(trim(coalesce(new.data->>'deliveredAt','')), '')::timestamptz;
          exception when others then
            v_basis := null;
          end;
        end if;
        if v_basis is null then
          v_basis := coalesce(new.created_at, now());
        end if;

        if v_terms = 'cash' then
          v_due := (v_basis::date);
        else
          v_due := (v_basis::date + greatest(v_net_days, 0));
        end if;
      end if;

      new.invoice_terms := v_terms;
      new.net_days := greatest(0, coalesce(v_net_days, 0));
      new.due_date := v_due;
      return new;
    end
    $function$
;

CREATE OR REPLACE FUNCTION public._trg_purchase_orders_po_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  begin
    if new.po_number is null or length(trim(new.po_number)) = 0 then
      new.po_number := public._assign_po_number(new.purchase_date);
    end if;
    if new.reference_number is not null and length(trim(new.reference_number)) = 0 then
      new.reference_number := null;
    end if;
    return new;
  end
  $function$
;

CREATE OR REPLACE FUNCTION public._uuid_or_null(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if p_value is null or nullif(btrim(p_value), '') is null then
    return null;
  end if;
  if btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return btrim(p_value)::uuid;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.allocate_landed_cost_to_inventory(p_shipment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id uuid;
  v_total_expenses_base numeric;
  v_inventory uuid := public.get_account_id_by_code('1410');
  v_clearing uuid := public.get_account_id_by_code('2060');
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id required';
  end if;

  if exists(select 1 from public.landed_cost_audit a where a.shipment_id = p_shipment_id) then
    return;
  end if;

  select je.id into v_entry_id
  from public.journal_entries je
  where je.source_table = 'import_shipments'
    and je.source_id = p_shipment_id::text
  limit 1;

  if v_entry_id is not null then
    insert into public.landed_cost_audit(shipment_id, total_expenses_base, journal_entry_id)
    values (p_shipment_id, 0, v_entry_id)
    on conflict (shipment_id) do nothing;
    return;
  end if;

  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  if v_total_expenses_base <= 0 then
    return;
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    current_date,
    concat('Landed cost allocation shipment ', p_shipment_id::text),
    'import_shipments',
    p_shipment_id::text,
    'landed_cost_allocation',
    auth.uid()
  )
  returning id into v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_inventory, v_total_expenses_base, 0, 'Capitalize landed cost'),
    (v_entry_id, v_clearing, 0, v_total_expenses_base, 'Clear landed cost');

  insert into public.landed_cost_audit(shipment_id, total_expenses_base, journal_entry_id)
  values (p_shipment_id, v_total_expenses_base, v_entry_id)
  on conflict (shipment_id) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.allocate_payment_to_open_item(p_open_item_id uuid, p_payment_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_open record;
  v_pay record;
  v_amount numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;
  if p_open_item_id is null or p_payment_id is null then
    raise exception 'required ids';
  end if;
  select * into v_open from public.ar_open_items where id = p_open_item_id for update;
  if not found then
    raise exception 'open item not found';
  end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  v_amount := greatest(0, coalesce(p_amount, 0));
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  if v_amount - 1e-9 > v_open.open_balance then
    raise exception 'allocation exceeds open balance';
  end if;
  insert into public.ar_allocations(open_item_id, payment_id, amount, occurred_at, created_by)
  values (p_open_item_id, p_payment_id, v_amount, v_pay.occurred_at, auth.uid())
  on conflict (open_item_id, payment_id) do update set amount = excluded.amount;
  update public.ar_open_items
  set open_balance = greatest(0, open_balance - v_amount),
      status = case when greatest(0, open_balance - v_amount) = 0 then 'closed' else status end,
      closed_at = case when greatest(0, open_balance - v_amount) = 0 then now() else closed_at end
  where id = p_open_item_id;
  update public.ar_payment_status
  set allocated = true,
      updated_at = now()
  where payment_id = p_payment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_promotion_to_cart(p_cart_payload jsonb, p_promotion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_bundle_qty numeric;
  v_coupon_code text;
  v_promo record;
  v_item record;
  v_item_input jsonb;
  v_required_qty numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_items jsonb := '[]'::jsonb;
  v_original_total numeric := 0;
  v_final_total numeric := 0;
  v_promo_expense numeric := 0;
  v_alloc jsonb := '[]'::jsonb;
  v_alloc_item jsonb;
  v_alloc_total_gross numeric := 0;
  v_gross_share numeric;
  v_alloc_rev numeric;
  v_alloc_rev_sum numeric := 0;
  v_now timestamptz := now();
  v_stock_available numeric;
  v_stock_reserved numeric;
  v_is_food boolean;
  v_image_url text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;

  if p_cart_payload is null then
    p_cart_payload := '{}'::jsonb;
  end if;

  v_customer_id := public._uuid_or_null(p_cart_payload->>'customerId');
  v_warehouse_id := public._uuid_or_null(p_cart_payload->>'warehouseId');
  if v_warehouse_id is null then
    v_warehouse_id := public._resolve_default_warehouse_id();
  end if;

  v_bundle_qty := coalesce(nullif((p_cart_payload->>'bundleQty')::numeric, null), 1);
  if v_bundle_qty <= 0 then
    v_bundle_qty := 1;
  end if;

  v_coupon_code := nullif(btrim(coalesce(p_cart_payload->>'couponCode', '')), '');

  select *
  into v_promo
  from public.promotions p
  where p.id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;
  if not v_promo.is_active then
    raise exception 'promotion_inactive';
  end if;
  if v_promo.approval_status <> 'approved' then
    raise exception 'promotion_requires_approval';
  end if;
  if v_now < v_promo.start_at or v_now > v_promo.end_at then
    raise exception 'promotion_outside_time_window';
  end if;
  if v_promo.exclusive_with_coupon and v_coupon_code is not null then
    raise exception 'promotion_coupon_conflict';
  end if;

  v_image_url := nullif(btrim(coalesce(v_promo.image_url, v_promo.data->>'imageUrl', '')), '');

  for v_item in
    select
      pi.item_id,
      pi.quantity,
      coalesce(mi.is_food, false) as is_food
    from public.promotion_items pi
    join public.menu_items mi on mi.id = pi.item_id
    where pi.promotion_id = p_promotion_id
    order by pi.sort_order asc, pi.created_at asc, pi.id asc
  loop
    v_required_qty := public._money_round(coalesce(v_item.quantity, 0) * v_bundle_qty, 6);
    if v_required_qty <= 0 then
      continue;
    end if;

    if not v_item.is_food then
      select coalesce(sm.available_quantity, 0), coalesce(sm.reserved_quantity, 0)
      into v_stock_available, v_stock_reserved
      from public.stock_management sm
      where sm.item_id::text = v_item.item_id
        and sm.warehouse_id = v_warehouse_id;

      if (coalesce(v_stock_available, 0) - coalesce(v_stock_reserved, 0)) + 1e-9 < v_required_qty then
        raise exception 'Insufficient stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    else
      select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0)), 0)
      into v_stock_available
      from public.batches b
      where b.item_id = v_item.item_id
        and b.warehouse_id = v_warehouse_id
        and (b.expiry_date is null or b.expiry_date >= current_date);

      if coalesce(v_stock_available, 0) + 1e-9 < v_required_qty then
        raise exception 'Insufficient FEFO stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    end if;

    v_unit_price := public.get_item_price_with_discount(v_item.item_id, v_customer_id, v_required_qty);
    v_unit_price := public._money_round(v_unit_price);
    v_line_gross := public._money_round(v_unit_price * v_required_qty);

    v_items := v_items || jsonb_build_object(
      'itemId', v_item.item_id,
      'quantity', v_required_qty,
      'unitPrice', v_unit_price,
      'grossTotal', v_line_gross
    );

    v_original_total := v_original_total + v_line_gross;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'promotion_has_no_items';
  end if;

  v_original_total := public._money_round(v_original_total);

  if v_promo.discount_mode = 'fixed_total' then
    v_final_total := public._money_round(coalesce(v_promo.fixed_total, 0) * v_bundle_qty);
  else
    v_final_total := public._money_round(v_original_total * (1 - (coalesce(v_promo.percent_off, 0) / 100.0)));
  end if;

  v_final_total := greatest(0, least(v_final_total, v_original_total));
  v_promo_expense := public._money_round(v_original_total - v_final_total);

  v_alloc_total_gross := greatest(v_original_total, 0);
  v_alloc_rev_sum := 0;

  for v_item_input in
    select value from jsonb_array_elements(v_items)
  loop
    v_line_gross := coalesce(nullif((v_item_input->>'grossTotal')::numeric, null), 0);
    if v_alloc_total_gross > 0 then
      v_gross_share := greatest(0, v_line_gross) / v_alloc_total_gross;
    else
      v_gross_share := 0;
    end if;
    v_alloc_rev := public._money_round(v_original_total * v_gross_share);
    v_alloc_rev_sum := v_alloc_rev_sum + v_alloc_rev;

    v_alloc_item := jsonb_build_object(
      'itemId', v_item_input->>'itemId',
      'quantity', coalesce(nullif((v_item_input->>'quantity')::numeric, null), 0),
      'unitPrice', coalesce(nullif((v_item_input->>'unitPrice')::numeric, null), 0),
      'grossTotal', v_line_gross,
      'allocatedRevenue', v_alloc_rev,
      'allocatedRevenuePct', v_gross_share
    );
    v_alloc := v_alloc || v_alloc_item;
  end loop;

  if abs(v_alloc_rev_sum - v_original_total) > 0.02 and jsonb_array_length(v_alloc) > 0 then
    v_alloc_item := v_alloc->(jsonb_array_length(v_alloc) - 1);
    v_alloc_item := jsonb_set(
      v_alloc_item,
      '{allocatedRevenue}',
      to_jsonb(public._money_round(coalesce(nullif((v_alloc_item->>'allocatedRevenue')::numeric, null), 0) + (v_original_total - v_alloc_rev_sum))),
      true
    );
    v_alloc := jsonb_set(v_alloc, array[(jsonb_array_length(v_alloc) - 1)::text], v_alloc_item, true);
  end if;

  return jsonb_build_object(
    'promotionId', v_promo.id::text,
    'name', v_promo.name,
    'imageUrl', v_image_url,
    'startAt', v_promo.start_at,
    'endAt', v_promo.end_at,
    'bundleQty', public._money_round(v_bundle_qty, 6),
    'displayOriginalTotal', v_promo.display_original_total,
    'computedOriginalTotal', v_original_total,
    'finalTotal', v_final_total,
    'promotionExpense', v_promo_expense,
    'items', v_items,
    'revenueAllocation', v_alloc,
    'warehouseId', v_warehouse_id::text,
    'customerId', case when v_customer_id is null then null else v_customer_id::text end,
    'appliedAt', v_now
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_supplier_credit_note(p_credit_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_note record;
  v_ap uuid;
  v_inv uuid;
  v_cogs uuid;
  v_total_amount numeric;
  v_je uuid;
  v_roots_total_received numeric := 0;
  v_root record;
  v_root_share numeric;
  v_chain_onhand numeric;
  v_inventory_part numeric;
  v_cogs_part numeric;
  v_batch record;
  v_batch_credit numeric;
  v_new_cost numeric;
  v_line record;
begin
  perform public._require_staff('apply_supplier_credit_note');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;
  if p_credit_note_id is null then
    raise exception 'p_credit_note_id is required';
  end if;

  select *
  into v_note
  from public.supplier_credit_notes n
  where n.id = p_credit_note_id
  for update;
  if not found then
    raise exception 'supplier credit note not found';
  end if;
  if v_note.status = 'applied' then
    return;
  end if;
  if v_note.status = 'cancelled' then
    raise exception 'credit note is cancelled';
  end if;

  v_total_amount := coalesce(v_note.amount, 0);
  if v_total_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_ap := public.get_account_id_by_code('2010');
  v_inv := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  if v_ap is null or v_inv is null or v_cogs is null then
    raise exception 'required accounts missing';
  end if;

  select coalesce(sum(coalesce(b.quantity_received,0)),0)
  into v_roots_total_received
  from public.batches b
  where b.receipt_id = v_note.reference_purchase_receipt_id;

  if v_roots_total_received <= 0 then
    raise exception 'no batches for receipt';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
  values (
    now(),
    concat('Supplier credit note ', v_note.id::text),
    'supplier_credit_notes',
    v_note.id::text,
    'applied',
    auth.uid(),
    'posted'
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_je;

  delete from public.journal_lines jl where jl.journal_entry_id = v_je;

  delete from public.supplier_credit_note_allocations a where a.credit_note_id = v_note.id;

  v_inventory_part := 0;
  v_cogs_part := 0;

  for v_root in
    select
      b.id as root_batch_id,
      b.item_id,
      b.quantity_received,
      b.cost_per_unit,
      b.unit_cost
    from public.batches b
    where b.receipt_id = v_note.reference_purchase_receipt_id
    order by b.created_at asc, b.id asc
  loop
    v_root_share := v_total_amount * (coalesce(v_root.quantity_received,0) / v_roots_total_received);

    with recursive chain as (
      select b.id
      from public.batches b
      where b.id = v_root.root_batch_id
      union all
      select b2.id
      from public.batches b2
      join chain c on (b2.data->>'sourceBatchId')::uuid = c.id
      where b2.data ? 'sourceBatchId'
    )
    select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
    into v_chain_onhand
    from chain c
    join public.batches b on b.id = c.id;

    if coalesce(v_root.quantity_received,0) <= 0 then
      continue;
    end if;

    v_inventory_part := v_inventory_part + (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0)));
    v_cogs_part := v_cogs_part + (v_root_share - (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0))));

    insert into public.supplier_credit_note_allocations(
      credit_note_id,
      root_batch_id,
      affected_batch_id,
      receipt_id,
      amount_total,
      amount_to_inventory,
      amount_to_cogs,
      batch_qty_received,
      batch_qty_onhand,
      batch_qty_sold,
      unit_cost_before,
      unit_cost_after
    )
    values (
      v_note.id,
      v_root.root_batch_id,
      v_root.root_batch_id,
      v_note.reference_purchase_receipt_id,
      v_root_share,
      v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0)),
      v_root_share - (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0))),
      coalesce(v_root.quantity_received,0),
      greatest(coalesce(v_chain_onhand,0),0),
      greatest(coalesce(v_root.quantity_received,0) - greatest(coalesce(v_chain_onhand,0),0), 0),
      coalesce(v_root.cost_per_unit, v_root.unit_cost, 0),
      coalesce(v_root.cost_per_unit, v_root.unit_cost, 0)
    );

    if coalesce(v_chain_onhand,0) <= 0 then
      continue;
    end if;

    for v_batch in
      with recursive chain as (
        select b.id
        from public.batches b
        where b.id = v_root.root_batch_id
        union all
        select b2.id
        from public.batches b2
        join chain c on (b2.data->>'sourceBatchId')::uuid = c.id
        where b2.data ? 'sourceBatchId'
      )
      select
        b.id as batch_id,
        b.cost_per_unit,
        b.unit_cost,
        greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
      from chain c
      join public.batches b on b.id = c.id
      where greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      for update
    loop
      v_batch_credit :=
        (v_root_share * (v_chain_onhand / coalesce(v_root.quantity_received,0))) * (v_batch.remaining / v_chain_onhand);

      v_new_cost := greatest(0, coalesce(v_batch.cost_per_unit, v_batch.unit_cost, 0) - (v_batch_credit / v_batch.remaining));

      update public.batches
      set cost_per_unit = v_new_cost,
          unit_cost = v_new_cost
      where id = v_batch.batch_id;

      insert into public.supplier_credit_note_allocations(
        credit_note_id,
        root_batch_id,
        affected_batch_id,
        receipt_id,
        amount_total,
        amount_to_inventory,
        amount_to_cogs,
        batch_qty_received,
        batch_qty_onhand,
        batch_qty_sold,
        unit_cost_before,
        unit_cost_after
      )
      values (
        v_note.id,
        v_root.root_batch_id,
        v_batch.batch_id,
        v_note.reference_purchase_receipt_id,
        v_root_share,
        v_batch_credit,
        0,
        coalesce(v_root.quantity_received,0),
        v_batch.remaining,
        0,
        coalesce(v_batch.cost_per_unit, v_batch.unit_cost, 0),
        v_new_cost
      );
    end loop;
  end loop;

  v_inventory_part := public._money_round(v_inventory_part);
  v_cogs_part := public._money_round(v_cogs_part);

  if v_inventory_part + v_cogs_part > v_total_amount + 0.01 then
    raise exception 'allocation exceeded amount';
  end if;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_je, v_ap, v_total_amount, 0, 'Supplier credit note');

  if v_inventory_part > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_je, v_inv, 0, v_inventory_part, 'Reduce inventory cost');
  end if;
  if v_cogs_part > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_je, v_cogs, 0, v_cogs_part, 'Reduce COGS');
  end if;

  update public.supplier_credit_notes
  set status = 'applied',
      applied_at = now(),
      journal_entry_id = v_je,
      updated_at = now()
  where id = v_note.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approval_required(p_request_type text, p_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.approval_policies p
  where p.request_type = p_request_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0));
  return v_count > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_approval_step(p_request_id uuid, p_step_no integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requested_by uuid;
  v_required_role text;
  v_actor_role text;
  v_remaining int;
begin
  select ar.requested_by
  into v_requested_by
  from public.approval_requests ar
  where ar.id = p_request_id;

  if v_requested_by is null then
    raise exception 'approval request not found';
  end if;

  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_requested_by = auth.uid() then
    raise exception 'self_approval_forbidden';
  end if;

  select s.approver_role
  into v_required_role
  from public.approval_steps s
  where s.request_id = p_request_id
    and s.step_no = p_step_no;

  if v_required_role is null then
    raise exception 'approval step not found';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true
  limit 1;

  if v_actor_role is null then
    raise exception 'not authorized';
  end if;

  if v_actor_role <> v_required_role and v_actor_role <> 'owner' then
    raise exception 'not authorized';
  end if;

  update public.approval_steps
  set status = 'approved', action_by = auth.uid(), action_at = now()
  where request_id = p_request_id
    and step_no = p_step_no
    and status = 'pending';

  if not found then
    raise exception 'approval step not pending';
  end if;

  select count(*)
  into v_remaining
  from public.approval_steps
  where request_id = p_request_id and status <> 'approved';

  if v_remaining = 0 then
    update public.approval_requests
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_request_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry public.journal_entries%rowtype;
  v_debit numeric;
  v_credit numeric;
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;

  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select *
  into v_entry
  from public.journal_entries je
  where je.id = p_entry_id
  for update;

  if not found then
    raise exception 'journal entry not found';
  end if;

  if v_entry.source_table <> 'manual' then
    raise exception 'not allowed';
  end if;

  if v_entry.status <> 'draft' then
    return v_entry.id;
  end if;

  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
  into v_debit, v_credit
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_debit <= 0 and v_credit <= 0 then
    raise exception 'empty entry';
  end if;

  if abs(coalesce(v_debit, 0) - coalesce(v_credit, 0)) > 1e-6 then
    raise exception 'entry not balanced';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'posted',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_entry_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'journal_entries.approve',
    'accounting',
    p_entry_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('entryId', p_entry_id::text),
    'MEDIUM',
    'ACCOUNTING_APPROVE'
  );

  return p_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ar_aging_as_of(p_as_of timestamp with time zone)
 RETURNS TABLE(invoice_id uuid, journal_entry_id uuid, original_amount numeric, open_balance numeric, days_past_due integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select
    a.invoice_id,
    a.journal_entry_id,
    a.original_amount,
    a.open_balance,
    greatest(0, (p_as_of::date - je.entry_date::date))::int as days_past_due
  from public.ar_open_items a
  join public.journal_entries je on je.id = a.journal_entry_id
  where a.status = 'open';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_invoice_number_if_missing(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_num text;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  select invoice_number into v_num from public.orders where id = p_order_id for update;
  if v_num is null or length(trim(v_num)) = 0 then
    v_num := public.generate_invoice_number();
    update public.orders
    set invoice_number = v_num,
        updated_at = now()
    where id = p_order_id;
  end if;
  return v_num;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_changed_columns(p_old jsonb, p_new jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
AS $function$
declare
  k text;
  keys text[];
  result text[] := '{}'::text[];
begin
  if p_old is null then
    p_old := '{}'::jsonb;
  end if;
  if p_new is null then
    p_new := '{}'::jsonb;
  end if;

  select array_agg(distinct key)
  into keys
  from (
    select jsonb_object_keys(p_old) as key
    union all
    select jsonb_object_keys(p_new) as key
  ) s;

  if keys is null then
    return result;
  end if;

  foreach k in array keys loop
    if (p_old -> k) is distinct from (p_new -> k) then
      result := array_append(result, k);
    end if;
  end loop;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_get_record_id(p_table text, p_row jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    WHEN 'admin_users' THEN RETURN p_row->>'auth_user_id';
    WHEN 'customers' THEN RETURN p_row->>'auth_user_id';
    WHEN 'orders' THEN RETURN p_row->>'id';
    WHEN 'menu_items' THEN RETURN p_row->>'id';
    WHEN 'stock_management' THEN RETURN p_row->>'item_id';
    WHEN 'purchase_orders' THEN RETURN p_row->>'id';
    WHEN 'purchase_items' THEN RETURN p_row->>'id';
    WHEN 'addons' THEN RETURN p_row->>'id';
    WHEN 'delivery_zones' THEN RETURN p_row->>'id';
    WHEN 'coupons' THEN RETURN p_row->>'id';
    WHEN 'ads' THEN RETURN p_row->>'id';
    WHEN 'challenges' THEN RETURN p_row->>'id';
    WHEN 'app_settings' THEN RETURN p_row->>'id';
    WHEN 'item_categories' THEN RETURN p_row->>'id';
    WHEN 'unit_types' THEN RETURN p_row->>'id';
    WHEN 'freshness_levels' THEN RETURN p_row->>'id';
    WHEN 'banks' THEN RETURN p_row->>'id';
    WHEN 'transfer_recipients' THEN RETURN p_row->>'id';
    WHEN 'reviews' THEN RETURN p_row->>'id';
    ELSE
      IF (p_row ? 'id') THEN RETURN p_row->>'id'; END IF;
      RETURN NULL;
  END CASE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table text := tg_table_name;
  v_op text := lower(tg_op);
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_record_id text;
  v_changed text[];
  v_changed_filtered text[] := '{}'::text[];
  v_key text;
  v_metadata jsonb;
  v_risk_level text;
  v_reason_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  IF v_table IN ('customers', 'reviews') AND NOT public.is_admin() THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  -- Try to capture reason from session setting (set by app before critical ops)
  -- App should run: set_config('app.audit_reason', 'USER_CANCELLATION', true);
  BEGIN
    v_reason_code := current_setting('app.audit_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_reason_code := NULL;
  END;

  v_metadata := jsonb_build_object(
    'table', v_table,
    'op', v_op
  );

  IF tg_op = 'INSERT' THEN
    v_new := to_jsonb(new);
    v_row := v_new;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'new_values', v_new);
    v_risk_level := public.calculate_risk_level(v_table, v_op, NULL, v_new);
  
  ELSIF tg_op = 'UPDATE' THEN
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    
    v_changed := public.audit_changed_columns(v_old, v_new);
    
    IF v_changed IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_changed LOOP
        IF v_key NOT IN ('updated_at', 'created_at', 'last_updated') THEN
          v_changed_filtered := array_append(v_changed_filtered, v_key);
        END IF;
      END LOOP;
    END IF;

    IF array_length(v_changed_filtered, 1) IS NULL THEN
      RETURN new;
    END IF;

    v_metadata := v_metadata || jsonb_build_object(
        'recordId', v_record_id, 
        'changedColumns', v_changed_filtered,
        'old_values', v_old,
        'new_values', v_new
    );
    v_risk_level := public.calculate_risk_level(v_table, v_op, v_old, v_new);

  ELSE -- DELETE
    v_old := to_jsonb(old);
    v_row := v_old;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'old_values', v_old);
    v_risk_level := public.calculate_risk_level(v_table, v_op, v_old, NULL);
  END IF;

  -- Enforce Reason Code for HIGH risk operations if missing (Soft Check for now to avoid breakage, but logs warning)
  IF v_risk_level = 'HIGH' AND v_reason_code IS NULL THEN
     v_reason_code := 'MISSING_REASON';
     -- In strict mode, we would: RAISE EXCEPTION 'Reason code is required for high risk operations';
  END IF;

  INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  VALUES (
    v_table || '.' || v_op,
    public.audit_table_module(v_table),
    jsonb_build_object(
      'recordId', v_record_id,
      'changedColumns', v_changed_filtered,
      'risk', v_risk_level
    )::text,
    auth.uid(),
    now(),
    v_metadata,
    v_risk_level,
    v_reason_code
  );

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_table_module(p_table text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  CASE p_table
    WHEN 'admin_users' THEN RETURN 'auth';
    WHEN 'customers' THEN RETURN 'customers';
    WHEN 'menu_items' THEN RETURN 'inventory';
    WHEN 'addons' THEN RETURN 'inventory';
    WHEN 'stock_management' THEN RETURN 'inventory';
    WHEN 'purchase_orders' THEN RETURN 'purchasing';
    WHEN 'purchase_items' THEN RETURN 'purchasing';
    WHEN 'delivery_zones' THEN RETURN 'orders';
    WHEN 'orders' THEN RETURN 'orders';
    WHEN 'coupons' THEN RETURN 'orders';
    WHEN 'ads' THEN RETURN 'marketing';
    WHEN 'challenges' THEN RETURN 'marketing';
    WHEN 'app_settings' THEN RETURN 'settings';
    WHEN 'item_categories' THEN RETURN 'inventory';
    WHEN 'unit_types' THEN RETURN 'inventory';
    WHEN 'freshness_levels' THEN RETURN 'inventory';
    WHEN 'banks' THEN RETURN 'settings';
    WHEN 'transfer_recipients' THEN RETURN 'settings';
    WHEN 'reviews' THEN RETURN 'reviews';
    ELSE
      RETURN 'system';
  END CASE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.balance_sheet(p_as_of date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(assets numeric, liabilities numeric, equity numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with tb as (
    select *
    from public.trial_balance(null, p_as_of, p_cost_center_id)
  ),
  sums as (
    select
      coalesce(sum(case when tb.account_type = 'asset' then (tb.debit - tb.credit) else 0 end), 0) as assets,
      coalesce(sum(case when tb.account_type = 'liability' then (tb.credit - tb.debit) else 0 end), 0) as liabilities,
      coalesce(sum(case when tb.account_type = 'equity' then (tb.credit - tb.debit) else 0 end), 0) as equity_base,
      coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income_sum,
      coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expense_sum
    from tb
  )
  select
    s.assets,
    s.liabilities,
    (s.equity_base + (s.income_sum - s.expense_sum)) as equity
  from sums s;
$function$
;

CREATE OR REPLACE FUNCTION public.block_writes_during_maintenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_maintenance_on() AND NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Service unavailable during maintenance' USING errcode = 'U0001';
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.branch_from_warehouse(p_warehouse_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.branch_id from public.warehouses w where w.id = p_warehouse_id
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_cash_shift_expected(p_shift_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift record;
  v_cash_in numeric;
  v_cash_out numeric;
begin
  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id;

  if not found then
    raise exception 'cash shift not found';
  end if;

  select
    coalesce(sum(case when p.direction = 'in' then p.amount else 0 end), 0),
    coalesce(sum(case when p.direction = 'out' then p.amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.payments p
  where p.method = 'cash'
    and p.shift_id = p_shift_id;

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_risk_level(p_table text, p_op text, p_old jsonb, p_new jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- DELETE operations are generally High Risk
  IF p_op = 'delete' THEN
    IF p_table IN ('orders', 'stock_management', 'purchase_orders', 'admin_users', 'journal_entries') THEN
        RETURN 'HIGH';
    END IF;
    RETURN 'MEDIUM';
  END IF;

  -- UPDATE operations
  IF p_op = 'update' THEN
    -- Orders: Status Change to Cancelled or Delivered is High/Medium
    IF p_table = 'orders' THEN
        IF (p_new->>'status') = 'cancelled' AND (p_old->>'status') <> 'cancelled' THEN
            RETURN 'HIGH';
        END IF;
        IF (p_new->>'status') = 'delivered' AND (p_old->>'status') <> 'delivered' THEN
            RETURN 'MEDIUM'; -- Delivery is normal but important
        END IF;
        -- Financial tampering check
        IF (p_new->>'total') <> (p_old->>'total') OR (p_new->>'subtotal') <> (p_old->>'subtotal') THEN
            RETURN 'HIGH';
        END IF;
    END IF;

    -- Stock: Quantity changes
    IF p_table = 'stock_management' THEN
        IF (p_new->>'available_quantity') <> (p_old->>'available_quantity') THEN
            RETURN 'MEDIUM'; -- Frequent but important
        END IF;
    END IF;

    -- Auth: Role/Permission changes
    IF p_table = 'admin_users' THEN
         RETURN 'HIGH';
    END IF;
  END IF;

  -- INSERT operations
  IF p_op = 'insert' THEN
     IF p_table IN ('admin_users') THEN
        RETURN 'HIGH';
     END IF;
  END IF;

  RETURN 'LOW';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_shipment_landed_cost(p_shipment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_fob_value numeric;
  v_total_qty numeric;
  v_total_expenses numeric;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  select
    coalesce(sum(isi.quantity * isi.unit_price_fob), 0),
    coalesce(sum(isi.quantity), 0)
  into v_total_fob_value, v_total_qty
  from public.import_shipments_items isi
  where isi.shipment_id = p_shipment_id;

  if coalesce(v_total_qty, 0) <= 0 then
    return;
  end if;

  select coalesce(sum(ie.amount * ie.exchange_rate), 0)
  into v_total_expenses
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  if coalesce(v_total_fob_value, 0) > 0 then
    update public.import_shipments_items
    set landing_cost_per_unit = unit_price_fob * (1 + (coalesce(v_total_expenses, 0) / v_total_fob_value)),
        updated_at = now()
    where shipment_id = p_shipment_id;
  else
    update public.import_shipments_items
    set landing_cost_per_unit = unit_price_fob + (coalesce(v_total_expenses, 0) / v_total_qty),
        updated_at = now()
    where shipment_id = p_shipment_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_three_way_match(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line record;
  v_qty_po numeric;
  v_qty_grn numeric;
  v_price_po numeric;
  v_qty_tol numeric;
  v_price_tol numeric;
  v_status text;
begin
  delete from public.three_way_match_results where invoice_id = p_invoice_id;

  for v_line in
    select *
    from public.supplier_invoice_lines
    where invoice_id = p_invoice_id
  loop
    select coalesce(sum(pi.quantity), 0), coalesce(avg(pi.unit_cost), 0)
    into v_qty_po, v_price_po
    from public.purchase_items pi
    where pi.purchase_order_id = v_line.po_id
      and pi.item_id = v_line.item_id;

    select coalesce(sum(pri.quantity), 0)
    into v_qty_grn
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.purchase_order_id = v_line.po_id
      and pri.item_id = v_line.item_id;

    select coalesce(it.qty_tolerance, 0), coalesce(it.price_tolerance, 0)
    into v_qty_tol, v_price_tol
    from public.invoice_tolerances it
    join public.supplier_invoices si on si.id = p_invoice_id
    where (it.supplier_id is null or it.supplier_id = si.supplier_id)
      and (it.item_id is null or it.item_id = v_line.item_id)
      and it.is_active = true
    order by (it.supplier_id is not null) desc, (it.item_id is not null) desc
    limit 1;

    if abs(coalesce(v_line.unit_price, 0) - coalesce(v_price_po, 0)) > v_price_tol then
      v_status := 'price_variance';
    elsif coalesce(v_line.quantity, 0) > coalesce(v_qty_grn, 0) + v_qty_tol then
      v_status := 'qty_variance';
    else
      v_status := 'matched';
    end if;

    insert into public.three_way_match_results(
      invoice_id, po_id, receipt_id, item_id,
      qty_po, qty_grn, qty_inv, price_po, price_inv, status
    )
    values (
      p_invoice_id, v_line.po_id, v_line.receipt_id, v_line.item_id,
      coalesce(v_qty_po, 0), coalesce(v_qty_grn, 0), coalesce(v_line.quantity, 0),
      coalesce(v_price_po, 0), coalesce(v_line.unit_price, 0), v_status
    );
  end loop;

  if exists (
    select 1 from public.three_way_match_results
    where invoice_id = p_invoice_id and status <> 'matched'
  ) then
    update public.supplier_invoices set status = 'exception' where id = p_invoice_id;
  else
    update public.supplier_invoices set status = 'matched' where id = p_invoice_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_expenses()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role in ('owner','manager')
        or ('expenses.manage' = any(coalesce(au.permissions, '{}'::text[])))
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_stock()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role in ('owner','manager')
        or ('stock.manage' = any(coalesce(au.permissions, '{}'::text[])))
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_accounting_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_admin_permission('accounting.view');
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view');
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_sales_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_admin_permission('reports.view');
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_status text;
  v_order_data jsonb;
  v_items jsonb;
  v_warehouse_id uuid;
  v_new_status text;
BEGIN
  -- 1. Validate Order
  SELECT status, data, data->'items'
  INTO v_order_status, v_order_data, v_items
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- 2. Check Permissions (Admin or Staff)
  IF NOT public.is_admin() AND NOT public.is_staff() THEN
     RAISE EXCEPTION 'not allowed';
  END IF;

  -- 3. Idempotency check
  IF v_order_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF v_order_status = 'delivered' THEN
    RAISE EXCEPTION 'Cannot cancel a delivered order. Use Return process instead.';
  END IF;

  -- 4. Release Reservations
  v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    PERFORM public.release_reserved_stock_for_order(
      p_items := v_items,
      p_order_id := p_order_id,
      p_warehouse_id := v_warehouse_id
    );
  END IF;

  -- 5. Update Order Status
  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_at = NOW(),
      data = jsonb_set(
        coalesce(data, '{}'::jsonb), 
        '{cancellationReason}', 
        to_jsonb(coalesce(p_reason, ''))
      )
  WHERE id = p_order_id
  RETURNING status INTO v_new_status;

  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'Update failed: 0 rows affected. Check RLS or Triggers.';
  END IF;

  IF v_new_status <> 'cancelled' THEN
    RAISE EXCEPTION 'Update failed: Status remained % after update. A trigger might be reverting changes.', v_new_status;
  END IF;

END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_order_id uuid, p_reason text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_has_receipts boolean;
  v_has_payments boolean;
  v_po record;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select exists(
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner','manager')
  ) into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'not allowed';
  end if;

  select *
  into v_po
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    return;
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  select exists(
    select 1
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.reference_id::text = p_order_id::text
  ) into v_has_payments;

  if coalesce(v_has_receipts, false) then
    raise exception 'cannot cancel received purchase order';
  end if;

  if coalesce(v_has_payments, false) or coalesce(v_po.paid_amount, 0) > 0 then
    raise exception 'cannot cancel paid purchase order';
  end if;

  update public.purchase_orders
  set status = 'cancelled',
      notes = case
        when nullif(trim(coalesce(p_reason, '')), '') is null then notes
        when nullif(trim(coalesce(notes, '')), '') is null then concat('[cancel] ', trim(p_reason))
        else concat(notes, E'\n', '[cancel] ', trim(p_reason))
      end,
      updated_at = now()
  where id = p_order_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'cancel',
    'purchases',
    concat('Cancelled purchase order ', p_order_id::text),
    auth.uid(),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('purchaseOrderId', p_order_id::text, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cash_flow_statement(p_start date, p_end date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(operating_activities numeric, investing_activities numeric, financing_activities numeric, net_cash_flow numeric, opening_cash numeric, closing_cash numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with cash_accounts as (
    select id from public.chart_of_accounts
    where code in ('1010', '1020') and is_active = true
  ),
  opening as (
    select coalesce(sum(jl.debit - jl.credit), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and p_start is not null
      and je.entry_date::date < p_start
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  operating as (
    select coalesce(sum(
      case
        when coa.code in ('1010', '1020') then (jl.debit - jl.credit)
        else 0
      end
    ), 0) as operating_cash
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and je.source_table in ('orders', 'payments', 'expenses', 'sales_returns', 'cash_shifts')
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  investing as (
    select 0::numeric as investing_cash
  ),
  financing as (
    select 0::numeric as financing_cash
  ),
  closing as (
    select coalesce(sum(jl.debit - jl.credit), 0) as closing_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    (select operating_cash from operating) as operating_activities,
    (select investing_cash from investing) as investing_activities,
    (select financing_cash from financing) as financing_activities,
    (select operating_cash from operating)
      + (select investing_cash from investing)
      + (select financing_cash from financing) as net_cash_flow,
    (select opening_balance from opening) as opening_cash,
    (select closing_balance from closing) as closing_cash;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_batch_invariants(p_item_id text DEFAULT NULL::text, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_over_consumed int := 0;
  v_negative_remaining int := 0;
  v_reserved_exceeds int := 0;
  v_totals_exceed int := 0;
  v_result json;
begin
  select count(*) into v_over_consumed
  from public.batches b
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and coalesce(b.quantity_consumed,0) > coalesce(b.quantity_received,0);

  select count(*) into v_negative_remaining
  from public.batches b
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and ((coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0)) < 0);

  with sm as (
    select sm.item_id::text as item_id_text, sm.warehouse_id, sm.data->'reservedBatches' as rb
    from public.stock_management sm
  ),
  entries as (
    select sm.item_id_text, sm.warehouse_id, e.key as batch_id_text, e.value as entry
    from sm, jsonb_each(coalesce(rb,'{}'::jsonb)) e
  ),
  normalized as (
    select item_id_text, warehouse_id, batch_id_text,
           case when jsonb_typeof(entry)='array' then entry else jsonb_build_array(entry) end as arr
    from entries
  ),
  sum_res as (
    select item_id_text, warehouse_id, batch_id_text,
           sum(coalesce(nullif(x.value->>'qty','')::numeric,0)) as reserved_qty
    from normalized, jsonb_array_elements(arr) x
    group by item_id_text, warehouse_id, batch_id_text
  )
  select count(*) into v_reserved_exceeds
  from public.batches b
  left join sum_res sr on sr.batch_id_text = b.id::text
                        and sr.item_id_text = b.item_id
                        and (sr.warehouse_id is not distinct from b.warehouse_id)
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and coalesce(sr.reserved_qty,0) > (coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) + 1e-9);

  with sm as (
    select sm.item_id::text as item_id_text, sm.warehouse_id, sm.data->'reservedBatches' as rb
    from public.stock_management sm
  ),
  entries as (
    select sm.item_id_text, sm.warehouse_id, e.key as batch_id_text, e.value as entry
    from sm, jsonb_each(coalesce(rb,'{}'::jsonb)) e
  ),
  normalized as (
    select item_id_text, warehouse_id, batch_id_text,
           case when jsonb_typeof(entry)='array' then entry else jsonb_build_array(entry) end as arr
    from entries
  ),
  sum_res as (
    select item_id_text, warehouse_id, batch_id_text,
           sum(coalesce(nullif(x.value->>'qty','')::numeric,0)) as reserved_qty
    from normalized, jsonb_array_elements(arr) x
    group by item_id_text, warehouse_id, batch_id_text
  ),
  agg as (
    select b.item_id, b.warehouse_id,
           sum(coalesce(b.quantity_received,0)) as total_received,
           sum(coalesce(b.quantity_consumed,0)) as total_consumed,
           sum(coalesce(sr.reserved_qty,0)) as total_reserved
    from public.batches b
    left join sum_res sr on sr.batch_id_text = b.id::text
                         and sr.item_id_text = b.item_id
                         and (sr.warehouse_id is not distinct from b.warehouse_id)
    where (p_item_id is null or b.item_id = p_item_id)
      and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    group by b.item_id, b.warehouse_id
  )
  select count(*) into v_totals_exceed
  from agg
  where (coalesce(total_consumed,0) + coalesce(total_reserved,0)) > (coalesce(total_received,0) + 1e-9);

  v_result := json_build_object(
    'ok', ((v_over_consumed = 0) and (v_negative_remaining = 0) and (v_reserved_exceeds = 0) and (v_totals_exceed = 0)),
    'violations', json_build_object(
      'over_consumed', v_over_consumed,
      'negative_remaining', v_negative_remaining,
      'reserved_exceeds_remaining', v_reserved_exceeds,
      'totals_exceed_received', v_totals_exceed
    )
  );

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_customer_credit_limit(p_customer_id uuid, p_order_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_limit numeric := 0;
  v_terms text := 'cash';
  v_current_balance numeric := 0;
  v_company_id uuid;
begin
  if p_customer_id is null then
    return true;
  end if;
  select coalesce(c.credit_limit, 0), coalesce(c.payment_terms, 'cash')
  into v_limit, v_terms
  from public.customers c
  where c.auth_user_id = p_customer_id;
  if not found then
    return true;
  end if;
  if v_terms = 'cash' then
    return true;
  end if;
  if v_limit <= 0 then
    return coalesce(p_order_amount, 0) <= 0;
  end if;

  select s.company_id into v_company_id
  from public.get_admin_session_scope() s
  limit 1;

  if v_company_id is null then
    v_current_balance := public.compute_customer_ar_balance(p_customer_id);
    update public.customers
    set current_balance = v_current_balance,
        updated_at = now()
    where auth_user_id = p_customer_id;
  else
    v_current_balance := public.compute_customer_ar_balance_in_company(p_customer_id, v_company_id);
  end if;

  return (v_current_balance + greatest(coalesce(p_order_amount, 0), 0)) <= v_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_accounting_period(p_period_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period record;
  v_entry_id uuid;
  v_entry_date timestamptz;
  v_retained uuid;
  v_income_total numeric := 0;
  v_expense_total numeric := 0;
  v_profit numeric := 0;
  v_amount numeric := 0;
  v_has_lines boolean := false;
  v_row record;
begin
  if not public.has_admin_permission('accounting.periods.close') then
    raise exception 'not allowed';
  end if;

  select *
  into v_period
  from public.accounting_periods ap
  where ap.id = p_period_id
  for update;

  if not found then
    raise exception 'period not found';
  end if;

  if v_period.status = 'closed' then
    return;
  end if;

  v_entry_date := (v_period.end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_retained := public.get_account_id_by_code('3000');
  if v_retained is null then
    raise exception 'Retained earnings account (3000) not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_entry_date,
    concat('Close period ', v_period.name),
    'accounting_periods',
    p_period_id::text,
    'closing',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  for v_row in
    select
      coa.id as account_id,
      coa.account_type,
      coalesce(sum(jl.debit), 0) as debit,
      coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.account_type in ('income', 'expense')
      and je.entry_date::date >= v_period.start_date
      and je.entry_date::date <= v_period.end_date
    group by coa.id, coa.account_type
  loop
    if v_row.account_type = 'income' then
      v_amount := (v_row.credit - v_row.debit);
      v_income_total := v_income_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(v_amount, 0),
          greatest(-v_amount, 0),
          'Close income'
        );
        v_has_lines := true;
      end if;
    else
      v_amount := (v_row.debit - v_row.credit);
      v_expense_total := v_expense_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(-v_amount, 0),
          greatest(v_amount, 0),
          'Close expense'
        );
        v_has_lines := true;
      end if;
    end if;
  end loop;

  v_profit := coalesce(v_income_total, 0) - coalesce(v_expense_total, 0);
  if abs(v_profit) > 1e-9 or v_has_lines then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_entry_id,
      v_retained,
      greatest(-v_profit, 0),
      greatest(v_profit, 0),
      'Retained earnings'
    );
  end if;

  update public.accounting_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = auth.uid()
  where id = p_period_id
    and status <> 'closed';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_cash_shift(p_shift_id uuid, p_end_amount numeric, p_notes text)
 RETURNS public.cash_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift public.cash_shifts%rowtype;
  v_expected numeric;
  v_end numeric;
  v_actor_role text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null then
    raise exception 'not allowed';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  if coalesce(v_shift.status, 'open') <> 'open' then
    return v_shift;
  end if;

  v_end := coalesce(p_end_amount, 0);
  if v_end < 0 then
    raise exception 'invalid end amount';
  end if;

  v_expected := public.calculate_cash_shift_expected(p_shift_id);

  update public.cash_shifts
  set closed_at = now(),
      end_amount = v_end,
      expected_amount = v_expected,
      difference = v_end - v_expected,
      status = 'closed',
      notes = nullif(coalesce(p_notes, ''), '')
  where id = p_shift_id
  returning * into v_shift;

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_cash_shift_v2(p_shift_id uuid, p_end_amount numeric, p_notes text DEFAULT NULL::text, p_forced_reason text DEFAULT NULL::text, p_denomination_counts jsonb DEFAULT NULL::jsonb, p_tender_counts jsonb DEFAULT NULL::jsonb)
 RETURNS public.cash_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift public.cash_shifts%rowtype;
  v_expected numeric;
  v_end numeric;
  v_actor_role text;
  v_diff numeric;
  v_forced boolean;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null then
    raise exception 'not allowed';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  if coalesce(v_shift.status, 'open') <> 'open' then
    return v_shift;
  end if;

  v_end := coalesce(p_end_amount, 0);
  if v_end < 0 then
    raise exception 'invalid end amount';
  end if;

  v_expected := public.calculate_cash_shift_expected(p_shift_id);
  v_diff := v_end - v_expected;
  v_forced := abs(v_diff) > 0.01;
  v_reason := nullif(trim(coalesce(p_forced_reason, '')), '');

  if v_forced and v_reason is null then
    raise exception 'يرجى إدخال سبب الإغلاق عند وجود فرق.';
  end if;

  update public.cash_shifts
  set closed_at = now(),
      end_amount = v_end,
      expected_amount = v_expected,
      difference = v_diff,
      status = 'closed',
      notes = nullif(coalesce(p_notes, ''), ''),
      denomination_counts = coalesce(p_denomination_counts, denomination_counts),
      tender_counts = coalesce(p_tender_counts, tender_counts),
      forced_close = v_forced,
      forced_close_reason = v_reason,
      closed_by = auth.uid()
  where id = p_shift_id
  returning * into v_shift;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'cash_shift_close',
    'cash_shifts',
    'Cash shift closed',
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'shiftId', p_shift_id::text,
      'endAmount', v_end,
      'expectedAmount', v_expected,
      'difference', v_diff,
      'forced', v_forced,
      'forcedReason', v_reason,
      'notes', nullif(coalesce(p_notes, ''), ''),
      'denominationCounts', p_denomination_counts,
      'tenderCounts', p_tender_counts
    )),
    case when v_forced then 'HIGH' else 'MEDIUM' end,
    case when v_forced then 'SHIFT_FORCED_CLOSE' else 'SHIFT_CLOSE' end
  );

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cod_post_delivery(p_order_id uuid, p_driver_id uuid, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_amount numeric;
  v_at timestamptz;
  v_entry_id uuid;
  v_balance numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;
  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'p_driver_id is required';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_amount := coalesce(nullif((v_order.data->>'total')::numeric, null), 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid order total';
  END IF;

  v_at := coalesce(p_occurred_at, now());

  -- idempotent: one delivery entry per order
  SELECT le.id
  INTO v_entry_id
  FROM public.ledger_entries le
  WHERE le.entry_type = 'delivery'
    AND le.reference_type = 'order'
    AND le.reference_id = p_order_id::text
  LIMIT 1;

  IF v_entry_id IS NULL THEN
    INSERT INTO public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
    VALUES (
      'delivery',
      'order',
      p_order_id::text,
      v_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text, 'driverId', p_driver_id::text, 'amount', v_amount)
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO public.ledger_lines(entry_id, account, debit, credit)
    VALUES
      -- Accrual recognition at delivery
      (v_entry_id, 'Accounts_Receivable_COD', v_amount, 0),
      (v_entry_id, 'Sales_Revenue', 0, v_amount),
      -- Cash collected from customer but still outside cashbox
      (v_entry_id, 'Cash_In_Transit', v_amount, 0),
      (v_entry_id, 'Accounts_Receivable_COD', 0, v_amount);
  END IF;

  -- Driver wallet/receivable (cash in hand with driver)
  v_balance := public._driver_ledger_next_balance(p_driver_id, v_amount, 0);
  INSERT INTO public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  VALUES (p_driver_id, 'order', p_order_id::text, v_amount, 0, v_balance, v_at, auth.uid())
  ON CONFLICT (driver_id, reference_type, reference_id) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cod_settle_order(p_order_id uuid, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_data jsonb;
  v_amount numeric;
  v_at timestamptz;
  v_driver_id uuid;
  v_shift_id uuid;
  v_settlement_id uuid;
  v_entry_id uuid;
  v_balance numeric;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_admin_permission('accounting.manage')) THEN
    RAISE EXCEPTION 'not authorized to post accounting entries';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;

  v_at := coalesce(p_occurred_at, now());

  SELECT s.id
  INTO v_shift_id
  FROM public.cash_shifts s
  WHERE s.cashier_id = auth.uid()
    AND coalesce(s.status, 'open') = 'open'
  ORDER BY s.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'cash method requires an open cash shift';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid order total';
  END IF;

  IF v_order.status::text <> 'delivered' THEN
    RAISE EXCEPTION 'order must be delivered first';
  END IF;

  IF NOT public._is_cod_delivery_order(v_data, v_order.delivery_zone_id) THEN
    RAISE EXCEPTION 'order is not COD delivery';
  END IF;

  IF nullif(v_data->>'paidAt','') IS NOT NULL THEN
    RETURN (v_data->>'paidAt')::timestamptz;
  END IF;

  v_driver_id := nullif(v_data->>'deliveredBy','')::uuid;
  IF v_driver_id IS NULL THEN
    v_driver_id := nullif(v_data->>'assignedDeliveryUserId','')::uuid;
  END IF;
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id is required for COD settlement';
  END IF;

  -- Ensure delivery ledger exists (idempotent creation)
  PERFORM public.cod_post_delivery(p_order_id, v_driver_id, coalesce(nullif(v_data->>'deliveredAt','')::timestamptz, v_at));

  INSERT INTO public.cod_settlements(driver_id, shift_id, total_amount, occurred_at, created_by, data)
  VALUES (v_driver_id, v_shift_id, v_amount, v_at, auth.uid(), jsonb_build_object('orderId', p_order_id::text))
  RETURNING id INTO v_settlement_id;

  INSERT INTO public.cod_settlement_orders(settlement_id, order_id, amount)
  VALUES (v_settlement_id, p_order_id, v_amount);

  INSERT INTO public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
  VALUES (
    'settlement',
    'settlement',
    v_settlement_id::text,
    v_at,
    auth.uid(),
    jsonb_build_object('orderId', p_order_id::text, 'driverId', v_driver_id::text, 'shiftId', v_shift_id::text, 'amount', v_amount)
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.ledger_lines(entry_id, account, debit, credit)
  VALUES
    (v_entry_id, 'Cash_On_Hand', v_amount, 0),
    (v_entry_id, 'Cash_In_Transit', 0, v_amount);

  v_balance := public._driver_ledger_next_balance(v_driver_id, 0, v_amount);
  INSERT INTO public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  VALUES (v_driver_id, 'settlement', v_settlement_id::text, 0, v_amount, v_balance, v_at, auth.uid());

  -- Create payment (cashbox event) inside the cashier shift (creates journal entry too)
  PERFORM public.record_order_payment(
    p_order_id,
    v_amount,
    'cash',
    v_at,
    'cod_settle:' || v_settlement_id::text
  );

  -- Only now: mark paidAt in orders.data
  v_data := jsonb_set(v_data, '{paidAt}', to_jsonb(v_at::text), true);
  UPDATE public.orders
  SET data = v_data,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN v_at;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cod_settle_orders(p_driver_id uuid, p_order_ids uuid[], p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift_id uuid;
  v_at timestamptz;
  v_settlement_id uuid;
  v_entry_id uuid;
  v_total numeric := 0;
  v_order_id uuid;
  v_order record;
  v_data jsonb;
  v_amount numeric;
  v_paid numeric;
  v_remaining numeric;
  v_balance numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_driver_id is null then
    raise exception 'p_driver_id is required';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null or array_length(p_order_ids, 1) = 0 then
    raise exception 'p_order_ids is required';
  end if;

  v_at := coalesce(p_occurred_at, now());

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  foreach v_order_id in array p_order_ids
  loop
    select o.*
    into v_order
    from public.orders o
    where o.id = v_order_id
    for update;

    if not found then
      raise exception 'order not found';
    end if;

    v_data := coalesce(v_order.data, '{}'::jsonb);

    if v_order.status::text <> 'delivered' then
      raise exception 'order must be delivered first';
    end if;

    if not public._is_cod_delivery_order(v_data, v_order.delivery_zone_id) then
      raise exception 'order is not COD delivery';
    end if;

    if nullif(v_data->>'paidAt','') is not null then
      raise exception 'order already settled';
    end if;

    if nullif(v_data->>'deliveredBy','')::uuid is distinct from p_driver_id
       and nullif(v_data->>'assignedDeliveryUserId','')::uuid is distinct from p_driver_id then
      raise exception 'order driver mismatch';
    end if;

    v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
    if v_amount <= 0 then
      raise exception 'invalid order total';
    end if;

    perform public.cod_post_delivery(v_order_id, p_driver_id, coalesce(nullif(v_data->>'deliveredAt','')::timestamptz, v_at));

    select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = v_order_id::text
      and p.direction = 'in';
    v_remaining := greatest(v_amount - v_paid, 0);
    v_total := v_total + v_remaining;
  end loop;

  if v_total <= 0 then
    raise exception 'invalid settlement amount';
  end if;

  insert into public.cod_settlements(driver_id, shift_id, total_amount, occurred_at, created_by, data)
  values (p_driver_id, v_shift_id, v_total, v_at, auth.uid(), jsonb_build_object('batch', true))
  returning id into v_settlement_id;

  foreach v_order_id in array p_order_ids
  loop
    select o.*
    into v_order
    from public.orders o
    where o.id = v_order_id;

    v_data := coalesce(v_order.data, '{}'::jsonb);
    v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
    select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = v_order_id::text
      and p.direction = 'in';
    v_remaining := greatest(v_amount - v_paid, 0);
    if v_remaining <= 0 then
      continue;
    end if;

    insert into public.cod_settlement_orders(settlement_id, order_id, amount)
    values (v_settlement_id, v_order_id, v_remaining);

    perform public.record_order_payment(
      v_order_id,
      v_remaining,
      'cash',
      v_at,
      'cod_settle_batch:' || v_settlement_id::text || ':' || v_order_id::text
    );

    v_data := jsonb_set(v_data, '{paidAt}', to_jsonb(v_at::text), true);
    update public.orders
    set data = v_data,
        updated_at = now()
    where id = v_order_id;
  end loop;

  insert into public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
  values (
    'settlement',
    'settlement',
    v_settlement_id::text,
    v_at,
    auth.uid(),
    jsonb_build_object('driverId', p_driver_id::text, 'shiftId', v_shift_id::text, 'amount', v_total, 'orderCount', array_length(p_order_ids, 1))
  )
  returning id into v_entry_id;

  insert into public.ledger_lines(entry_id, account, debit, credit)
  values
    (v_entry_id, 'Cash_On_Hand', v_total, 0),
    (v_entry_id, 'Cash_In_Transit', 0, v_total);

  v_balance := public._driver_ledger_next_balance(p_driver_id, 0, v_total);
  insert into public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  values (p_driver_id, 'settlement', v_settlement_id::text, 0, v_total, v_balance, v_at, auth.uid());

  return v_settlement_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.company_from_branch(p_branch_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.company_id from public.branches b where b.id = p_branch_id
$function$
;

CREATE OR REPLACE FUNCTION public.complete_warehouse_transfer(p_transfer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_from_warehouse uuid;
  v_to_warehouse uuid;
  v_transfer_date date;
  v_needed numeric;
  v_batch record;
  v_reserved_other numeric;
  v_available numeric;
  v_alloc numeric;
  v_unit_cost numeric;
begin
  perform public._require_stock_manager('complete_warehouse_transfer');

  select from_warehouse_id, to_warehouse_id, transfer_date
  into v_from_warehouse, v_to_warehouse, v_transfer_date
  from public.warehouse_transfers
  where id = p_transfer_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Transfer not found or not pending';
  end if;

  for v_item in
    select item_id, quantity
    from public.warehouse_transfer_items
    where transfer_id = p_transfer_id
  loop
    v_needed := v_item.quantity;
    if v_needed <= 0 then
      continue;
    end if;

    for v_batch in
      select bb.batch_id, bb.quantity, bb.expiry_date
      from public.batch_balances bb
      where bb.item_id = v_item.item_id
        and bb.warehouse_id = v_from_warehouse
        and bb.quantity > 0
        and (bb.expiry_date is null or bb.expiry_date >= current_date)
      order by bb.expiry_date asc nulls last, bb.batch_id asc
    loop
      exit when v_needed <= 0;

      select coalesce(sum(br.quantity), 0)
      into v_reserved_other
      from public.batch_reservations br
      where br.item_id = v_item.item_id
        and br.warehouse_id = v_from_warehouse
        and br.batch_id = v_batch.batch_id;

      v_available := greatest(coalesce(v_batch.quantity, 0) - coalesce(v_reserved_other, 0), 0);
      if v_available <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_available);
      if v_alloc <= 0 then
        continue;
      end if;

      update public.batch_balances
      set quantity = quantity - v_alloc,
          updated_at = now()
      where item_id = v_item.item_id
        and batch_id = v_batch.batch_id
        and warehouse_id = v_from_warehouse;

      insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
      values (v_item.item_id, v_batch.batch_id, v_to_warehouse, v_alloc, v_batch.expiry_date)
      on conflict (item_id, batch_id, warehouse_id)
      do update set
        quantity = public.batch_balances.quantity + excluded.quantity,
        expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
        updated_at = now();

      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_batch.batch_id
        and im.item_id::text = v_item.item_id::text
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, 0);

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item.item_id, 'adjust_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
        'warehouse_transfers', p_transfer_id::text, v_transfer_date::timestamptz, auth.uid(),
        jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
        v_batch.batch_id,
        v_from_warehouse
      );

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item.item_id, 'adjust_in', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
        'warehouse_transfers', p_transfer_id::text, v_transfer_date::timestamptz, auth.uid(),
        jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
        v_batch.batch_id,
        v_to_warehouse
      );

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 0 then
      raise exception 'Insufficient FEFO-valid stock for item % in source warehouse', v_item.item_id;
    end if;

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item.item_id
            and bb.warehouse_id = v_from_warehouse
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item.item_id::text
      and sm.warehouse_id = v_from_warehouse;

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item.item_id
            and bb.warehouse_id = v_to_warehouse
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item.item_id::text
      and sm.warehouse_id = v_to_warehouse;

    update public.warehouse_transfer_items
    set transferred_quantity = v_item.quantity
    where transfer_id = p_transfer_id
      and item_id = v_item.item_id;
  end loop;

  update public.warehouse_transfers
  set status = 'completed',
      completed_at = now(),
      approved_by = auth.uid()
  where id = p_transfer_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'warehouse_transfer_completed',
    'inventory',
    format('Completed transfer %s', p_transfer_id),
    auth.uid(),
    now(),
    jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_customer_ar_balance(p_customer_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ar as (
    select public.get_account_id_by_code('1200') as ar_id
  )
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join ar on jl.account_id = ar.ar_id
  left join public.orders o_del
    on je.source_table = 'orders'
   and je.source_event = 'delivered'
   and je.source_id = o_del.id::text
  left join public.payments pay
    on je.source_table = 'payments'
   and je.source_id = pay.id::text
  left join public.orders o_pay
    on pay.reference_table = 'orders'
   and pay.reference_id = o_pay.id::text
  where (o_del.customer_auth_user_id = p_customer_id or o_pay.customer_auth_user_id = p_customer_id);
$function$
;

CREATE OR REPLACE FUNCTION public.compute_customer_ar_balance_in_company(p_customer_id uuid, p_company_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ar as (
    select public.get_account_id_by_code('1200') as ar_id
  )
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join ar on jl.account_id = ar.ar_id
  left join public.orders o_del
    on je.source_table = 'orders'
   and je.source_event = 'delivered'
   and je.source_id = o_del.id::text
  left join public.payments pay
    on je.source_table = 'payments'
   and je.source_id = pay.id::text
  left join public.orders o_pay
    on pay.reference_table = 'orders'
   and pay.reference_id = o_pay.id::text
  where (o_del.customer_auth_user_id = p_customer_id or o_pay.customer_auth_user_id = p_customer_id)
    and (p_company_id is null or coalesce(o_del.company_id, o_pay.company_id, je.company_id) = p_company_id);
$function$
;

CREATE OR REPLACE FUNCTION public.compute_order_tax_lines(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item jsonb;
  v_tax_code text;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_jurisdiction uuid;
  v_line_total numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  delete from public.order_tax_lines where order_id = p_order_id;

  select ctp.jurisdiction_id into v_jurisdiction
  from public.customer_tax_profiles ctp
  where ctp.customer_id = v_order.customer_auth_user_id
  limit 1;

  for v_item in select value from jsonb_array_elements(coalesce(v_order.items, v_order.data->'items', '[]'::jsonb))
  loop
    v_tax_code := nullif(v_item->>'taxCode', '');
    if v_tax_code is null then
      select itp.tax_code into v_tax_code
      from public.item_tax_profiles itp
      where itp.item_id = coalesce(v_item->>'itemId', v_item->>'id')
      limit 1;
    end if;
    if v_tax_code is null or v_jurisdiction is null then
      raise exception 'missing tax profile';
    end if;
    select tr.rate into v_tax_rate
    from public.tax_rates tr
    where tr.jurisdiction_id = v_jurisdiction
      and tr.tax_code = v_tax_code
      and tr.effective_from <= current_date
      and (tr.effective_to is null or tr.effective_to >= current_date)
    order by tr.effective_from desc
    limit 1;
    if v_tax_rate is null then
      raise exception 'missing tax rate';
    end if;
    v_line_total := coalesce((v_item->>'price')::numeric, 0) * coalesce((v_item->>'quantity')::numeric, 0);
    v_tax_amount := v_line_total * v_tax_rate;
    insert into public.order_tax_lines(order_id, tax_code, tax_rate, tax_amount)
    values (p_order_id, v_tax_code, v_tax_rate, v_tax_amount);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id uuid, p_items jsonb, p_updated_data jsonb, p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor uuid;
    v_order record;
    v_order_data jsonb;
    v_promos jsonb;
    v_promos_fixed jsonb := '[]'::jsonb;
    v_line jsonb;
    v_snapshot jsonb;
    v_items_all jsonb := '[]'::jsonb;
    v_item jsonb;
    v_final_data jsonb;
    v_is_cod boolean := false;
    v_driver_id uuid;
    v_delivered_at timestamptz;
    v_order_source text;
    v_customer_id uuid;
    v_amount numeric;
    v_customer_type text;
    v_ok boolean;
    v_deposits_paid numeric := 0;
    v_net_ar numeric := 0;
    v_err text;
    v_reason text;
begin
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;
    v_actor := auth.uid();
    v_order_source := '';
    if auth.role() <> 'service_role' then
      if not public.is_staff() then
        raise exception 'not allowed';
      end if;
    end if;
    select *
    into v_order
    from public.orders o
    where o.id = p_order_id
    for update;
    if not found then
      raise exception 'order not found';
    end if;
    v_order_data := coalesce(v_order.data, '{}'::jsonb);
    v_order_source := coalesce(nullif(v_order_data->>'orderSource',''), nullif(p_updated_data->>'orderSource',''), '');
    if auth.role() <> 'service_role' then
      if v_order_source = 'in_store' then
        if not public.has_admin_permission('orders.markPaid') then
          raise exception 'not allowed';
        end if;
      else
        if not (public.has_admin_permission('orders.updateStatus.all') or public.has_admin_permission('orders.updateStatus.delivery')) then
          raise exception 'not allowed';
        end if;
        if public.has_admin_permission('orders.updateStatus.delivery') and not public.has_admin_permission('orders.updateStatus.all') then
          if (v_order_data->>'assignedDeliveryUserId') is distinct from v_actor::text then
            raise exception 'not allowed';
          end if;
        end if;
      end if;
    end if;

    v_customer_id := coalesce(
      nullif(v_order_data->>'customerId','')::uuid,
      nullif(p_updated_data->>'customerId','')::uuid,
      (select c.auth_user_id from public.customers c where c.auth_user_id = v_order.customer_auth_user_id limit 1)
    );
    v_amount := coalesce(nullif((v_order_data->>'total')::numeric, null), nullif((p_updated_data->>'total')::numeric, null), 0);
    if v_customer_id is not null then
      select c.customer_type
      into v_customer_type
      from public.customers c
      where c.auth_user_id = v_customer_id;
    end if;
    if v_customer_type = 'wholesale' then
      v_delivered_at := now();
      select coalesce(sum(p.amount), 0)
      into v_deposits_paid
      from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = p_order_id::text
        and p.direction = 'in'
        and p.occurred_at < v_delivered_at;
      v_deposits_paid := least(greatest(coalesce(v_amount, 0), 0), greatest(coalesce(v_deposits_paid, 0), 0));
      v_net_ar := greatest(0, coalesce(v_amount, 0) - v_deposits_paid);

      select public.check_customer_credit_limit(v_customer_id, v_net_ar)
      into v_ok;
      if not v_ok then
        raise exception 'CREDIT_LIMIT_EXCEEDED';
      end if;
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      p_items := '[]'::jsonb;
    end if;
    v_items_all := p_items;
    v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
    v_is_cod := public._is_cod_delivery_order(v_order_data, v_order.delivery_zone_id);
    if v_is_cod then
      v_driver_id := nullif(coalesce(p_updated_data->>'deliveredBy', p_updated_data->>'assignedDeliveryUserId', v_order_data->>'deliveredBy', v_order_data->>'assignedDeliveryUserId'),'')::uuid;
      if v_driver_id is null then
        raise exception 'delivery_driver_required';
      end if;
    end if;
    if jsonb_typeof(v_promos) = 'array' and jsonb_array_length(v_promos) > 0 then
      if nullif(btrim(coalesce(v_order_data->>'appliedCouponCode', '')), '') is not null then
        raise exception 'promotion_coupon_conflict';
      end if;
      if coalesce(nullif((v_order_data->>'pointsRedeemedValue')::numeric, null), 0) > 0 then
        raise exception 'promotion_points_conflict';
      end if;
      for v_line in select value from jsonb_array_elements(v_promos)
      loop
        v_snapshot := public._compute_promotion_snapshot(
          (v_line->>'promotionId')::uuid,
          null,
          p_warehouse_id,
          coalesce(nullif((v_line->>'bundleQty')::numeric, null), 1),
          null,
          true
        );
        v_snapshot := v_snapshot || jsonb_build_object('promotionLineId', v_line->>'promotionLineId');
        v_promos_fixed := v_promos_fixed || v_snapshot;
        for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb))
        loop
          v_items_all := v_items_all || jsonb_build_object(
            'itemId', v_item->>'itemId',
            'quantity', coalesce(nullif((v_item->>'quantity')::numeric, null), 0)
          );
        end loop;
        insert into public.promotion_usage(
          promotion_id,
          promotion_line_id,
          order_id,
          bundle_qty,
          channel,
          warehouse_id,
          snapshot,
          created_by
        )
        values (
          (v_snapshot->>'promotionId')::uuid,
          (v_snapshot->>'promotionLineId')::uuid,
          p_order_id,
          coalesce(nullif((v_snapshot->>'bundleQty')::numeric, null), 1),
          'in_store',
          p_warehouse_id,
          v_snapshot,
          auth.uid()
        )
        on conflict (promotion_line_id) do nothing;
      end loop;
      v_items_all := public._merge_stock_items(v_items_all);
    else
      v_items_all := public._merge_stock_items(v_items_all);
    end if;

    if jsonb_array_length(v_items_all) = 0 then
      v_items_all := public._extract_stock_items_from_order_data(v_order_data);
    end if;
    if jsonb_array_length(v_items_all) = 0 then
      raise exception 'no deliverable items';
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = p_order_id::text
        and im.movement_type = 'sale_out'
    ) then
      update public.orders
      set status = 'delivered',
          data = p_updated_data,
          updated_at = now()
      where id = p_order_id;
      return;
    end if;

    begin
      perform public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);
    exception when others then
      v_err := coalesce(sqlerrm, '');
      if v_err = 'SELLING_BELOW_COST_NOT_ALLOWED' then
        raise;
      end if;
      if v_err ilike '%batch not released or recalled%' then
        raise exception 'BATCH_NOT_RELEASED';
      end if;
      if v_err = 'BATCH_EXPIRED' then
        raise exception 'NO_VALID_BATCH';
      end if;
      if v_err ilike '%insufficient%' or v_err ilike '%INSUFFICIENT%' then
        v_reason := null;
        for v_item in select value from jsonb_array_elements(coalesce(v_items_all,'[]'::jsonb))
        loop
          v_reason := public._resolve_batch_sale_failure_reason(
            coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id','')),
            p_warehouse_id,
            coalesce(nullif((v_item->>'quantity')::numeric, null), coalesce(nullif((v_item->>'qty')::numeric, null), 0))
          );
          if v_reason is not null then
            raise exception '%', v_reason;
          end if;
        end loop;
        raise exception 'INSUFFICIENT_BATCH_QUANTITY';
      end if;
      raise;
    end;

    v_final_data := coalesce(p_updated_data, v_order_data);
    if jsonb_array_length(v_promos_fixed) > 0 then
      v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos_fixed, true);
    end if;
    if v_is_cod then
      v_final_data := v_final_data - 'paidAt';
      v_driver_id := nullif(v_final_data->>'deliveredBy','')::uuid;
      if v_driver_id is null then
        v_driver_id := nullif(v_final_data->>'assignedDeliveryUserId','')::uuid;
      end if;
      if v_driver_id is not null then
        v_delivered_at := coalesce(nullif(v_final_data->>'deliveredAt','')::timestamptz, now());
        perform public.cod_post_delivery(p_order_id, v_driver_id, v_delivered_at);
      end if;
    end if;
    update public.orders
    set status = 'delivered',
        data = v_final_data,
        updated_at = now()
    where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := (p_payload->>'order_id')::uuid;

  UPDATE orders
  SET status = 'delivered'
  WHERE id = v_order_id;

  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery_with_credit(p_order_id uuid, p_items jsonb, p_updated_data jsonb, p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;

  perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery_with_credit(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- متغيراتك هنا
BEGIN
  -- منطقك هنا
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.convert_qty(p_qty numeric, p_from uuid, p_to uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_num bigint;
  v_den bigint;
begin
  if p_from = p_to then
    return p_qty;
  end if;
  select numerator, denominator into v_num, v_den
  from public.uom_conversions
  where from_uom_id = p_from and to_uom_id = p_to
  limit 1;
  if v_num is null or v_den is null then
    raise exception 'missing uom conversion';
  end if;
  return p_qty * (v_num::numeric / v_den::numeric);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_accounting_document(p_document_type text, p_source_table text, p_source_id text, p_branch_id uuid, p_company_id uuid, p_memo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  select id into v_id
  from public.accounting_documents
  where source_table = p_source_table and source_id = p_source_id;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.accounting_documents(
    document_type, source_table, source_id, branch_id, company_id, status, memo, created_by
  )
  values (
    p_document_type, p_source_table, p_source_id, p_branch_id, p_company_id, 'posted', p_memo, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_approval_request(p_target_table text, p_target_id text, p_request_type text, p_amount numeric, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_request_id uuid;
  v_policy_id uuid;
  v_payload_hash text;
begin
  if not public.approval_required(p_request_type, p_amount) then
    raise exception 'approval policy not found for request_type %', p_request_type;
  end if;

  v_payload_hash := encode(digest(convert_to(coalesce(p_payload::text, ''), 'utf8'), 'sha256'::text), 'hex');

  insert into public.approval_requests(
    target_table, target_id, request_type, status, requested_by, payload_hash
  )
  values (
    p_target_table, p_target_id, p_request_type, 'pending', auth.uid(), v_payload_hash
  )
  returning id into v_request_id;

  select p.id into v_policy_id
  from public.approval_policies p
  where p.request_type = p_request_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0))
  order by p.min_amount desc
  limit 1;

  insert into public.approval_steps(request_id, step_no, approver_role, status)
  select v_request_id, s.step_no, s.approver_role, 'pending'
  from public.approval_policy_steps s
  where s.policy_id = v_policy_id
  order by s.step_no asc;

  return v_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_manual_journal_entry(p_entry_date timestamp with time zone, p_memo text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_memo text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_memo := nullif(trim(coalesce(p_memo, '')), '');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_entry_date, now()),
    v_memo,
    'manual',
    null,
    null,
    auth.uid()
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    if v_debit < 0 or v_credit < 0 then
      raise exception 'invalid debit/credit';
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'invalid line amounts';
    end if;

    v_account_id := public.get_account_id_by_code(v_account_code);
    if v_account_id is null then
      raise exception 'account not found %', v_account_code;
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      nullif(trim(coalesce(v_line->>'memo', '')), '')
    );
  end loop;

  return v_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_order_secure(p_items jsonb, p_delivery_zone_id uuid, p_payment_method text, p_notes text, p_address text, p_location jsonb, p_customer_name text, p_phone_number text, p_is_scheduled boolean, p_scheduled_at timestamp with time zone, p_coupon_code text DEFAULT NULL::text, p_points_redeemed_value numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_order_id uuid;
    v_item_input jsonb;
    v_menu_item record;
    v_menu_item_data jsonb;
    v_cart_item jsonb;
    v_final_items jsonb := '[]'::jsonb;
    v_subtotal numeric := 0;
    v_total numeric := 0;
    v_delivery_fee numeric := 0;
    v_discount_amount numeric := 0;
    v_tax_amount numeric := 0;
    v_tax_rate numeric := 0;
    v_points_earned numeric := 0;
    v_settings jsonb;
    v_zone_data jsonb;
    v_line_total numeric;
    v_addons_price numeric;
    v_unit_price numeric;
    v_base_price numeric;
    v_addon_key text;
    v_addon_qty numeric;
    v_addon_def jsonb;
    v_grade_id text;
    v_grade_def jsonb;
    v_weight numeric;
    v_quantity numeric;
    v_unit_type text;
    v_delivery_pin text;
    v_available_addons jsonb;
    v_selected_addons_map jsonb;
    v_final_selected_addons jsonb;
    v_points_settings jsonb;
    v_currency_val_per_point numeric;
    v_points_per_currency numeric;
    v_coupon_record record;
    v_stock_items jsonb := '[]'::jsonb;
    v_item_name_ar text;
    v_item_name_en text;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'User not authenticated';
    end if;

    if exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = v_user_id
        and au.is_active = true
      limit 1
    ) then
      raise exception 'لا يمكن لحسابات الموظفين إنشاء طلبات كعميل. استخدم شاشة الإدارة/نقطة البيع.';
    end if;

    select data into v_settings from public.app_settings where id = 'singleton';
    if v_settings is null then
        v_settings := '{}'::jsonb;
    end if;

    for v_item_input in select * from jsonb_array_elements(p_items)
    loop
        select * into v_menu_item from public.menu_items where id = (v_item_input->>'itemId');
        if not found then
            raise exception 'Item not found: %', v_item_input->>'itemId';
        end if;
        
        v_menu_item_data := v_menu_item.data;
        v_item_name_ar := v_menu_item_data->'name'->>'ar';
        v_item_name_en := v_menu_item_data->'name'->>'en';

        v_quantity := coalesce((v_item_input->>'quantity')::numeric, 0);
        v_weight := coalesce((v_item_input->>'weight')::numeric, 0);
        v_unit_type := coalesce(v_menu_item.unit_type, 'piece');
        
        if v_unit_type in ('kg', 'gram') then
             if v_unit_type = 'gram' and (v_menu_item.price_per_unit is not null or (v_menu_item_data->>'pricePerUnit') is not null) then
                 v_base_price := coalesce(v_menu_item.price_per_unit, (v_menu_item_data->>'pricePerUnit')::numeric) / 1000;
                 v_base_price := v_base_price * v_weight;
             else
                 v_base_price := v_menu_item.price * v_weight;
             end if;
             if v_quantity <= 0 then v_quantity := 1; end if;
        else
             v_base_price := v_menu_item.price;
             if v_quantity <= 0 then raise exception 'Quantity must be positive for item %', v_menu_item.id; end if;
        end if;

        v_grade_id := v_item_input->>'gradeId';
        v_grade_def := null;
        if v_grade_id is not null and (v_menu_item_data->'availableGrades') is not null then
             select value into v_grade_def 
             from jsonb_array_elements(v_menu_item_data->'availableGrades') 
             where value->>'id' = v_grade_id;
             
             if v_grade_def is not null then
                 v_base_price := v_base_price * coalesce((v_grade_def->>'priceMultiplier')::numeric, 1.0);
             end if;
        end if;

        v_addons_price := 0;
        v_available_addons := coalesce(v_menu_item_data->'addons', '[]'::jsonb);
        v_selected_addons_map := coalesce(v_item_input->'selectedAddons', '{}'::jsonb);
        v_final_selected_addons := '{}'::jsonb;
        
        for v_addon_key in select jsonb_object_keys(v_selected_addons_map)
        loop
            v_addon_qty := (v_selected_addons_map->>v_addon_key)::numeric;
            if v_addon_qty > 0 then
                select value into v_addon_def
                from jsonb_array_elements(v_available_addons)
                where value->>'id' = v_addon_key;
                
                if v_addon_def is not null then
                    v_addons_price := v_addons_price + ((v_addon_def->>'price')::numeric * v_addon_qty);
                    
                    v_final_selected_addons := jsonb_set(
                        v_final_selected_addons,
                        array[v_addon_key],
                        jsonb_build_object('addon', v_addon_def, 'quantity', v_addon_qty)
                    );
                end if;
            end if;
        end loop;

        v_unit_price := v_base_price + v_addons_price;
        v_line_total := (v_base_price + v_addons_price) * v_quantity; 
        
        v_subtotal := v_subtotal + v_line_total;

        v_cart_item := v_menu_item_data || jsonb_build_object(
            'quantity', v_quantity,
            'weight', v_weight,
            'selectedAddons', v_final_selected_addons,
            'selectedGrade', v_grade_def,
            'cartItemId', gen_random_uuid()::text,
            'price', v_menu_item.price
        );
        
        v_final_items := v_final_items || v_cart_item;
        
        v_stock_items := v_stock_items || jsonb_build_object(
            'itemId', v_menu_item.id,
            'quantity', v_quantity
        );
    end loop;

    if p_delivery_zone_id is not null then
        select data into v_zone_data from public.delivery_zones where id = p_delivery_zone_id;
        if v_zone_data is not null and (v_zone_data->>'isActive')::boolean then
             v_delivery_fee := coalesce((v_zone_data->>'deliveryFee')::numeric, 0);
        else
             v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
        end if;
    else
        v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
    end if;

    if (v_settings->'deliverySettings'->>'freeDeliveryThreshold') is not null and 
       v_subtotal >= (v_settings->'deliverySettings'->>'freeDeliveryThreshold')::numeric then
        v_delivery_fee := 0;
    end if;

    if p_coupon_code is not null and length(p_coupon_code) > 0 then
        select * into v_coupon_record from public.coupons where lower(code) = lower(p_coupon_code) and is_active = true;
        if found then
             if (v_coupon_record.data->>'expiresAt') is not null and (v_coupon_record.data->>'expiresAt')::timestamptz < now() then
                 raise exception 'Coupon expired';
             end if;
             if (v_coupon_record.data->>'minOrderAmount') is not null and v_subtotal < (v_coupon_record.data->>'minOrderAmount')::numeric then
                 raise exception 'Order amount too low for coupon';
             end if;
             if (v_coupon_record.data->>'usageLimit') is not null and 
                coalesce((v_coupon_record.data->>'usageCount')::int, 0) >= (v_coupon_record.data->>'usageLimit')::int then
                 raise exception 'Coupon usage limit reached';
             end if;
             
             if (v_coupon_record.data->>'type') = 'percentage' then
                 v_discount_amount := v_subtotal * ((v_coupon_record.data->>'value')::numeric / 100);
                 if (v_coupon_record.data->>'maxDiscount') is not null then
                     v_discount_amount := least(v_discount_amount, (v_coupon_record.data->>'maxDiscount')::numeric);
                 end if;
             else
                 v_discount_amount := (v_coupon_record.data->>'value')::numeric;
             end if;
             
             v_discount_amount := least(v_discount_amount, v_subtotal);
             
             update public.coupons 
             set data = jsonb_set(data, '{usageCount}', (coalesce((data->>'usageCount')::int, 0) + 1)::text::jsonb)
             where id = v_coupon_record.id;
        else
             v_discount_amount := 0;
        end if;
    end if;

    if p_points_redeemed_value > 0 then
        v_points_settings := v_settings->'loyaltySettings';
        if (v_points_settings->>'enabled')::boolean then
             v_currency_val_per_point := coalesce((v_points_settings->>'currencyValuePerPoint')::numeric, 0);
             if v_currency_val_per_point > 0 then
                 declare
                     v_user_points int;
                     v_points_needed numeric;
                 begin
                     select loyalty_points into v_user_points from public.customers where auth_user_id = v_user_id;
                     v_points_needed := p_points_redeemed_value / v_currency_val_per_point;
                     
                     if coalesce(v_user_points, 0) < v_points_needed then
                         raise exception 'Insufficient loyalty points';
                     end if;
                     
                     update public.customers 
                     set loyalty_points = loyalty_points - v_points_needed::int
                     where auth_user_id = v_user_id;
                     
                     v_discount_amount := v_discount_amount + p_points_redeemed_value;
                 end;
             end if;
        end if;
    end if;

    if (v_settings->'taxSettings'->>'enabled')::boolean then
        v_tax_rate := coalesce((v_settings->'taxSettings'->>'rate')::numeric, 0);
        v_tax_amount := greatest(0, v_subtotal - v_discount_amount) * (v_tax_rate / 100);
    end if;

    v_total := greatest(0, v_subtotal - v_discount_amount) + v_delivery_fee + v_tax_amount;

    v_points_settings := v_settings->'loyaltySettings';
    if (v_points_settings->>'enabled')::boolean then
        v_points_per_currency := coalesce((v_points_settings->>'pointsPerCurrencyUnit')::numeric, 0);
        v_points_earned := floor(v_subtotal * v_points_per_currency);
    end if;

    v_delivery_pin := floor(random() * 9000 + 1000)::text;

    insert into public.orders (
        customer_auth_user_id,
        status,
        invoice_number,
        data
    )
    values (
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        null,
        jsonb_build_object(
            'id', gen_random_uuid(),
            'userId', v_user_id,
            'orderSource', 'online',
            'items', v_final_items,
            'subtotal', v_subtotal,
            'deliveryFee', v_delivery_fee,
            'discountAmount', v_discount_amount,
            'total', v_total,
            'taxAmount', v_tax_amount,
            'taxRate', v_tax_rate,
            'pointsEarned', v_points_earned,
            'pointsRedeemedValue', p_points_redeemed_value,
            'deliveryZoneId', p_delivery_zone_id,
            'paymentMethod', p_payment_method,
            'notes', p_notes,
            'address', p_address,
            'location', p_location,
            'customerName', p_customer_name,
            'phoneNumber', p_phone_number,
            'isScheduled', p_is_scheduled,
            'scheduledAt', p_scheduled_at,
            'deliveryPin', v_delivery_pin,
            'appliedCouponCode', p_coupon_code
        )
    )
    returning id into v_order_id;

    update public.orders 
    set data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    where id = v_order_id
    returning data into v_item_input;

    perform public.reserve_stock_for_order(v_stock_items, v_order_id);

    insert into public.order_events (order_id, action, actor_type, actor_id, to_status, payload)
    values (
        v_order_id,
        'order.created',
        'customer',
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        jsonb_build_object(
            'total', v_total,
            'method', p_payment_method
        )
    );

    return v_item_input;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_order_secure_with_payment_proof(p_items jsonb, p_delivery_zone_id uuid, p_payment_method text, p_notes text, p_address text, p_location jsonb, p_customer_name text, p_phone_number text, p_is_scheduled boolean, p_scheduled_at timestamp with time zone, p_coupon_code text DEFAULT NULL::text, p_points_redeemed_value numeric DEFAULT 0, p_payment_proof_type text DEFAULT NULL::text, p_payment_proof text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment_method text;
  v_proof_type text;
  v_proof text;
  v_order jsonb;
  v_order_id uuid;
  v_coupon_id uuid;
  v_customer_name text;
  v_phone text;
  v_address text;
begin
  v_payment_method := lower(btrim(coalesce(p_payment_method, '')));
  if v_payment_method not in ('cash', 'kuraimi', 'network') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  v_customer_name := btrim(coalesce(p_customer_name, ''));
  if length(v_customer_name) < 3 or length(v_customer_name) > 50 or v_customer_name !~ '^[\u0600-\u06FFa-zA-Z\s]+$' then
    raise exception 'اسم العميل غير صحيح';
  end if;

  v_phone := btrim(coalesce(p_phone_number, ''));
  if v_phone !~ '^(77|73|71|70)[0-9]{7}$' then
    raise exception 'رقم الهاتف غير صحيح';
  end if;

  v_address := btrim(coalesce(p_address, ''));
  if length(v_address) < 10 or length(v_address) > 200 then
    raise exception 'العنوان غير صحيح';
  end if;

  v_proof_type := nullif(btrim(coalesce(p_payment_proof_type, '')), '');
  v_proof := nullif(btrim(coalesce(p_payment_proof, '')), '');

  if v_payment_method = 'cash' then
    if v_proof_type is not null or v_proof is not null then
      raise exception 'لا يسمح بإثبات دفع للدفع النقدي';
    end if;
  else
    if v_payment_method in ('kuraimi', 'network') then
      if v_proof_type is null or v_proof is null then
        raise exception 'إثبات الدفع مطلوب لطرق الدفع غير النقدية';
      end if;
      if v_proof_type not in ('image', 'ref_number') then
        raise exception 'نوع إثبات الدفع غير صالح';
      end if;
    end if;
  end if;

  if p_coupon_code is not null and length(btrim(p_coupon_code)) > 0 then
    select c.id
    into v_coupon_id
    from public.coupons c
    where lower(c.code) = lower(btrim(p_coupon_code))
      and c.is_active = true
    for update;
  end if;

  v_order := public.create_order_secure(
    p_items,
    p_delivery_zone_id,
    v_payment_method,
    p_notes,
    v_address,
    p_location,
    v_customer_name,
    v_phone,
    p_is_scheduled,
    p_scheduled_at,
    p_coupon_code,
    p_points_redeemed_value
  );

  v_order_id := (v_order->>'id')::uuid;

  if v_payment_method in ('kuraimi', 'network') then
    update public.orders
    set data = jsonb_set(
      jsonb_set(data, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(p_payment_proof),
      true
    )
    where id = v_order_id;

    v_order := jsonb_set(
      jsonb_set(v_order, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(p_payment_proof),
      true
    );
  end if;

  return v_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_production_order(p_inputs jsonb, p_outputs jsonb, p_notes text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_in jsonb;
  v_out jsonb;
  v_item_id text;
  v_qty numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_inputs_total_cost numeric := 0;
  v_outputs_total_qty numeric := 0;
  v_out_unit_cost numeric := 0;
  v_movement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' then
    raise exception 'p_inputs must be a json array';
  end if;
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' then
    raise exception 'p_outputs must be a json array';
  end if;

  insert into public.production_orders(occurred_at, created_by, notes)
  values (coalesce(p_occurred_at, now()), auth.uid(), p_notes)
  returning id into v_order_id;

  for v_in in select value from jsonb_array_elements(p_inputs)
  loop
    v_item_id := v_in->>'itemId';
    v_qty := coalesce(nullif(v_in->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid input itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;
    if not found then
      raise exception 'Stock record not found for input %', v_item_id;
    end if;
    if (v_old_qty + 1e-9) < v_qty then
      raise exception 'Insufficient stock for input % (available %, requested %)', v_item_id, v_old_qty, v_qty;
    end if;

    v_unit_cost := v_old_avg;
    v_total_cost := v_unit_cost * v_qty;
    v_inputs_total_cost := v_inputs_total_cost + v_total_cost;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_qty),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.production_order_inputs(order_id, item_id, quantity, unit_cost, total_cost)
    values (v_order_id, v_item_id, v_qty, v_unit_cost, v_total_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'adjust_out', v_qty, v_unit_cost, v_total_cost,
      'production_orders', v_order_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('reason', 'production_consume', 'productionOrderId', v_order_id)
    )
    returning id into v_movement_id;
  end loop;

  for v_out in select value from jsonb_array_elements(p_outputs)
  loop
    v_outputs_total_qty := v_outputs_total_qty + coalesce(nullif(v_out->>'quantity', '')::numeric, 0);
  end loop;
  if v_outputs_total_qty <= 0 then
    raise exception 'Total output quantity must be > 0';
  end if;
  v_out_unit_cost := v_inputs_total_cost / v_outputs_total_qty;

  for v_out in select value from jsonb_array_elements(p_outputs)
  loop
    v_item_id := v_out->>'itemId';
    v_qty := coalesce(nullif(v_out->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid output itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    v_unit_cost := v_out_unit_cost;
    v_total_cost := v_unit_cost * v_qty;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = case when (coalesce(v_old_qty, 0) + v_qty) <= 1e-9
                        then v_unit_cost
                        else ((coalesce(v_old_qty, 0) * coalesce(v_old_avg, 0)) + (v_qty * v_unit_cost)) / (coalesce(v_old_qty, 0) + v_qty)
                   end,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.production_order_outputs(order_id, item_id, quantity, unit_cost, total_cost)
    values (v_order_id, v_item_id, v_qty, v_unit_cost, v_total_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'adjust_in', v_qty, v_unit_cost, v_total_cost,
      'production_orders', v_order_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('reason', 'production_output', 'productionOrderId', v_order_id)
    )
    returning id into v_movement_id;
  end loop;

  perform public.post_production_order(v_order_id);
  return v_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_purchase_return(p_order_id uuid, p_items jsonb, p_reason text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po record;
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_qty numeric;
  v_po_unit_cost numeric;
  v_stock_available numeric;
  v_stock_reserved numeric;
  v_stock_avg_cost numeric;
  v_return_item_total numeric;
  v_return_total numeric := 0;
  v_new_total numeric;
  v_return_id uuid;
  v_movement_id uuid;
  v_stock_item_id_is_uuid boolean;
  v_return_items_item_id_is_uuid boolean;
  v_inventory_movements_item_id_is_uuid boolean;
  v_inventory_movements_reference_id_is_uuid boolean;
  v_has_sm_warehouse boolean := false;
  v_has_im_batch boolean := false;
  v_has_im_warehouse boolean := false;
  v_has_bb boolean := false;
  v_has_bb_warehouse boolean := false;
  v_wh uuid;
  v_received_qty numeric;
  v_prev_returned numeric;
  v_needed numeric;
  v_take numeric;
  v_batch record;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(p_items) e
    where coalesce(nullif(e.value->>'quantity', '')::numeric, 0) > 0
  ) then
    raise exception 'no return items';
  end if;
  v_has_sm_warehouse := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_management'
      and column_name = 'warehouse_id'
  );
  v_has_bb := to_regclass('public.batch_balances') is not null;
  if v_has_bb then
    v_has_bb_warehouse := exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'batch_balances'
        and column_name = 'warehouse_id'
    );
  end if;
  v_has_im_batch := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'batch_id'
  );
  v_has_im_warehouse := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'warehouse_id'
  );
  select (t.typname = 'uuid')
  into v_stock_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'stock_management'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;
  select (t.typname = 'uuid')
  into v_return_items_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'purchase_return_items'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;
  select (t.typname = 'uuid')
  into v_inventory_movements_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;
  select (t.typname = 'uuid')
  into v_inventory_movements_reference_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'reference_id'
    and a.attnum > 0
    and not a.attisdropped;
  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'purchase order not found';
  end if;
  if v_po.status = 'cancelled' then
    raise exception 'cannot return for cancelled purchase order';
  end if;
  if v_has_sm_warehouse then
    v_wh := coalesce(v_po.warehouse_id, public._resolve_default_warehouse_id());
    if v_wh is null then
      raise exception 'warehouse_id is required';
    end if;
  else
    v_wh := null;
  end if;
  insert into public.purchase_returns(purchase_order_id, returned_at, created_by, reason)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid(), nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_return_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;
    if coalesce(v_stock_item_id_is_uuid, false)
      or coalesce(v_return_items_item_id_is_uuid, false)
      or coalesce(v_inventory_movements_item_id_is_uuid, false)
    then
      begin
        v_item_id_uuid := v_item_id_text::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id_text;
      end;
    end if;
    select coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_received_qty, v_po_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = v_item_id_text
    for update;
    if not found then
      raise exception 'item % not found in purchase order', v_item_id_text;
    end if;
    select coalesce(sum(pri.quantity), 0)
    into v_prev_returned
    from public.purchase_returns pr
    join public.purchase_return_items pri on pri.return_id = pr.id
    where pr.purchase_order_id = p_order_id
      and pri.item_id::text = v_item_id_text;
    if (coalesce(v_prev_returned, 0) + v_qty) > (coalesce(v_received_qty, 0) + 1e-9) then
      raise exception 'return exceeds received for item %', v_item_id_text;
    end if;
    if v_has_sm_warehouse then
      if coalesce(v_stock_item_id_is_uuid, false) then
        execute $q$
          insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, $2, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $3
          on conflict (item_id, warehouse_id) do nothing
        $q$
        using v_item_id_uuid, v_wh, v_item_id_text;
      else
        execute $q$
          insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, $2, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $3
          on conflict (item_id, warehouse_id) do nothing
        $q$
        using v_item_id_text, v_wh, v_item_id_text;
      end if;
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      into v_stock_available, v_stock_reserved, v_stock_avg_cost
      from public.stock_management sm
      where sm.item_id::text = v_item_id_text
        and sm.warehouse_id = v_wh
      for update;
    else
      if coalesce(v_stock_item_id_is_uuid, false) then
        execute $q$
          insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $2
          on conflict (item_id) do nothing
        $q$
        using v_item_id_uuid, v_item_id_text;
      else
        execute $q$
          insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $2
          on conflict (item_id) do nothing
        $q$
        using v_item_id_text, v_item_id_text;
      end if;
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      into v_stock_available, v_stock_reserved, v_stock_avg_cost
      from public.stock_management sm
      where sm.item_id::text = v_item_id_text
      for update;
    end if;
    if not found then
      raise exception 'Stock record not found for item %', v_item_id_text;
    end if;
    if (coalesce(v_stock_available, 0) - coalesce(v_stock_reserved, 0) + 1e-9) < v_qty then
      raise exception 'insufficient stock for return for item %', v_item_id_text;
    end if;
    if v_has_sm_warehouse then
      update public.stock_management
      set available_quantity = available_quantity - v_qty,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id_text
        and warehouse_id = v_wh;
    else
      update public.stock_management
      set available_quantity = available_quantity - v_qty,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id_text;
    end if;
    v_return_item_total := v_qty * coalesce(v_po_unit_cost, 0);
    v_return_total := v_return_total + v_return_item_total;
    if coalesce(v_return_items_item_id_is_uuid, false) then
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_uuid, v_qty, v_po_unit_cost, v_return_item_total;
    else
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_text, v_qty, v_po_unit_cost, v_return_item_total;
    end if;
    if coalesce(v_stock_avg_cost, 0) <= 0 then
      v_stock_avg_cost := coalesce(v_po_unit_cost, 0);
    end if;
    v_needed := v_qty;
    if v_has_bb and v_has_bb_warehouse and v_has_im_batch and v_has_im_warehouse then
      for v_batch in
        select bb.batch_id, coalesce(bb.quantity, 0) as qty, bb.expiry_date
        from public.batch_balances bb
        where bb.item_id::text = v_item_id_text
          and bb.warehouse_id = v_wh
          and coalesce(bb.quantity, 0) > 0
        order by (bb.expiry_date is null) asc, bb.expiry_date asc, bb.batch_id asc
        for update
      loop
        exit when v_needed <= 0;
        v_take := least(v_needed, coalesce(v_batch.qty, 0));
        if v_take <= 0 then
          continue;
        end if;
        update public.batch_balances
        set quantity = quantity - v_take,
            updated_at = now()
        where item_id::text = v_item_id_text
          and batch_id = v_batch.batch_id
          and warehouse_id = v_wh;
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          end if;
        end if;
        perform public.post_inventory_movement(v_movement_id);
        v_needed := v_needed - v_take;
      end loop;
      if v_needed > 0.000000001 then
        raise exception 'insufficient batch stock for return for item %', v_item_id_text;
      end if;
    else
      if v_has_im_warehouse then
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          end if;
        end if;
      else
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          end if;
        end if;
      end if;
      perform public.post_inventory_movement(v_movement_id);
    end if;
  end loop;
  if coalesce(v_po.total_amount, 0) > 0 and v_return_total > 0 then
    v_new_total := greatest(0, coalesce(v_po.total_amount, 0) - v_return_total);
    update public.purchase_orders
    set total_amount = v_new_total,
        paid_amount = least(coalesce(purchase_orders.paid_amount, 0), v_new_total),
        updated_at = now()
    where id = p_order_id;
  end if;
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'return',
    'purchases',
    concat('Created purchase return ', v_return_id::text, ' for PO ', p_order_id::text),
    auth.uid(),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('purchaseOrderId', p_order_id::text, 'purchaseReturnId', v_return_id::text, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
  return v_return_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_reversal_entry(p_entry_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry record;
  v_new_id uuid;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
  values (
    now(),
    concat('Reversal: ', coalesce(v_entry.memo, ''), ' ', coalesce(p_reason, '')),
    'journal_entries',
    v_entry.id::text,
    'reversal',
    auth.uid(),
    v_entry.document_id,
    v_entry.branch_id,
    v_entry.company_id
  )
  returning id into v_new_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select v_new_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deactivate_promotion(p_promotion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;
  update public.promotions
  set is_active = false,
      updated_at = now()
  where id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decrypt_text(p_encrypted bytea)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  IF p_encrypted IS NULL THEN 
    RETURN NULL;
  END IF;

  -- Try decrypting
  BEGIN
    RETURN pgp_sym_decrypt(p_encrypted, v_key);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL; -- Return null if decryption fails (wrong key)
  END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_warehouse_id uuid;
  v_is_food boolean;
  v_stock_id uuid;
  v_available numeric;
  v_reserved numeric;
  v_avg_cost numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  
  -- Reservation vars
  v_res_lines jsonb;
  v_qty_from_res numeric;
  v_qty_needed_free numeric;
  
  -- Batch vars
  v_batch_id uuid;
  v_batch_expiry date;
  v_batch_qty numeric;
  v_batch_reserved numeric;
  v_batch_free numeric;
  v_alloc numeric;
  v_remaining_needed numeric;
  
  v_order_data jsonb;
BEGIN
  -- 1. Validation & Setup
  if not public.is_admin() and not public.is_staff() then
     if auth.role() != 'service_role' and not public.is_admin() then
        raise exception 'not allowed';
     end if;
  end if;

  if p_order_id is null then raise exception 'p_order_id is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a json array'; end if;

  -- Get Order Info (Warehouse)
  select data into v_order_data from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  
  v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
  
  -- Clear existing COGS for this order to avoid duplication if run multiple times (though usually run once)
  delete from public.order_item_cogs where order_id = p_order_id;

  -- 2. Process Items
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    if v_item_id_text is null or v_item_id_text = '' then raise exception 'Invalid itemId'; end if;
    if v_requested <= 0 then continue; end if;

    -- Check if Item is Food
    select coalesce(mi.category = 'food', false) into v_is_food
    from public.menu_items mi where mi.id = v_item_id_text;

    -- Lock Stock Record
    -- Try UUID first
    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    if v_item_id_uuid is not null then
       select available_quantity, reserved_quantity, avg_cost
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id = v_item_id_uuid and warehouse_id = v_warehouse_id
       for update;
    else
       select available_quantity, reserved_quantity, avg_cost
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id::text = v_item_id_text and warehouse_id = v_warehouse_id
       for update;
    end if;

    if not found then raise exception 'Stock record not found for item %', v_item_id_text; end if;
    
    -- 3. Consume Reservations (Ledger)
    v_qty_from_res := 0;
    
    -- Find and Delete Reservation Lines for this Order/Item
    -- We use a CTE to delete and return the deleted rows
    WITH deleted_rows AS (
      DELETE FROM public.reservation_lines
      WHERE order_id = p_order_id
        AND item_id = v_item_id_text
        AND warehouse_id = v_warehouse_id
        AND status = 'reserved'
      RETURNING batch_id, quantity, expiry_date
    )
    SELECT 
      coalesce(sum(quantity), 0),
      coalesce(jsonb_agg(jsonb_build_object('batchId', batch_id, 'qty', quantity, 'expiry', expiry_date)), '[]'::jsonb)
    INTO v_qty_from_res, v_res_lines
    FROM deleted_rows;
    
    -- Refresh Stock Variables
    if v_item_id_uuid is not null then
       select available_quantity, reserved_quantity
       into v_available, v_reserved
       from public.stock_management
       where item_id = v_item_id_uuid and warehouse_id = v_warehouse_id;
    else
       select available_quantity, reserved_quantity
       into v_available, v_reserved
       from public.stock_management
       where item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
    end if;

    -- 4. Calculate Remaining Needed from Free Stock
    v_qty_needed_free := v_requested - v_qty_from_res;
    
    if v_qty_needed_free > 0 then
       -- Check Free Stock Availability
       -- Free Stock = Available - Reserved (Total Reserved for everyone)
       -- If POS (in_store), we strictly respect reservations now (INV-004 fix).
       if (v_available - v_reserved) < v_qty_needed_free then
          raise exception 'Insufficient free stock for item %. Needed: %, Free: % (Available: %, Reserved: %)', 
            v_item_id_text, v_qty_needed_free, (v_available - v_reserved), v_available, v_reserved;
       end if;
    end if;
    
    -- 5. Update Available Quantity
    if v_item_id_uuid is not null then
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           last_updated = now()
       WHERE item_id = v_item_id_uuid and warehouse_id = v_warehouse_id;
    else
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           last_updated = now()
       WHERE item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
    end if;

    -- 6. Generate Movements & COGS
    
    -- A. Non-Food Item
    if not v_is_food then
       v_unit_cost := v_avg_cost;
       v_total_cost := v_requested * v_unit_cost;
       
       -- Insert COGS
       insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
       values (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());
       
       -- Insert Movement
       insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, warehouse_id
       ) values (
        v_item_id_text, 'sale_out', v_requested, v_unit_cost, v_total_cost,
        'orders', p_order_id::text, now(), auth.uid(), 
        jsonb_build_object('orderId', p_order_id, 'warehouseId', v_warehouse_id), 
        v_warehouse_id
       ) returning id into v_movement_id;
       
       perform public.post_inventory_movement(v_movement_id);
       
    -- B. Food Item (Batch Management)
    else
       -- Process "Reserved" Batches first
       if v_qty_from_res > 0 then
          declare
             v_r_batch jsonb;
          begin
             for v_r_batch in select value from jsonb_array_elements(v_res_lines)
             loop
                v_batch_id := (v_r_batch->>'batchId')::uuid;
                v_alloc := (v_r_batch->>'qty')::numeric;
                
                -- Get Cost
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
                
                -- Insert COGS
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
                -- Insert Movement
                insert into public.inventory_movements(
                  item_id, movement_type, quantity, unit_cost, total_cost,
                  reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
                ) values (
                  v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
                  'orders', p_order_id::text, now(), auth.uid(),
                  jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_r_batch->>'expiry'),
                  v_batch_id, v_warehouse_id
                ) returning id into v_movement_id;
                
                perform public.post_inventory_movement(v_movement_id);
             end loop;
          end;
       end if;
       
       -- Process "Free" Batches (FEFO)
       if v_qty_needed_free > 0 then
          v_remaining_needed := v_qty_needed_free;
          
          for v_batch_id, v_batch_expiry, v_batch_qty in
             select b.id, b.expiry_date,
               greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
             from public.batches b
             where b.item_id = v_item_id_text
               and b.warehouse_id = v_warehouse_id
               and (b.expiry_date is null or b.expiry_date >= current_date)
             order by b.expiry_date asc nulls last, b.created_at asc
          loop
             exit when v_remaining_needed <= 0;
             if v_batch_qty <= 0 then continue; end if;
             
             -- Calculate Free Qty on this batch (Batch Total - Batch Reserved)
             select coalesce(sum(quantity), 0) into v_batch_reserved
             from public.reservation_lines
             where batch_id = v_batch_id and status = 'reserved';
             
             v_batch_free := greatest(0, v_batch_qty - v_batch_reserved);
             
             if v_batch_free > 0 then
                v_alloc := least(v_remaining_needed, v_batch_free);
                
                -- Get Cost
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
                
                -- Insert COGS
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
                -- Insert Movement
                insert into public.inventory_movements(
                  item_id, movement_type, quantity, unit_cost, total_cost,
                  reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
                ) values (
                  v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
                  'orders', p_order_id::text, now(), auth.uid(),
                  jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch_expiry),
                  v_batch_id, v_warehouse_id
                ) returning id into v_movement_id;
                
                perform public.post_inventory_movement(v_movement_id);
                
                v_remaining_needed := v_remaining_needed - v_alloc;
             end if;
          end loop;
          
          if v_remaining_needed > 0 then
             raise exception 'Insufficient free batch stock for item %', v_item_id_text;
          end if;
       end if;
    end if; -- End Food/Non-Food
    
  end loop; -- End Items Loop
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb, p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_in_store boolean := false;
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_needed numeric;
  v_item_batch_text text;
  v_is_food boolean;
  v_avg_cost numeric;
  v_batch record;
  v_alloc numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_qr numeric;
  v_qc numeric;
begin
  perform public._require_staff('deduct_stock_on_delivery_v2');
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  if exists (
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.warehouse_id = p_warehouse_id
      and im.movement_type = 'sale_out'
  ) then
    return;
  end if;

  select (coalesce(nullif(o.data->>'orderSource',''), '') = 'in_store')
  into v_is_in_store
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;

  delete from public.order_item_cogs where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id',''));
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, nullif(v_item->>'qty','')::numeric, 0);
    v_item_batch_text := nullif(v_item->>'batchId', '');
    if v_item_id is null or v_item_id = '' or v_requested <= 0 then
      continue;
    end if;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;

    select coalesce(sm.avg_cost, 0)
    into v_avg_cost
    from public.stock_management sm
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = p_warehouse_id;

    v_needed := v_requested;

    if not coalesce(v_is_in_store, false) then
      for v_batch in
        select
          r.id as reservation_id,
          r.quantity as reserved_qty,
          b.id as batch_id,
          b.expiry_date,
          b.unit_cost,
          greatest(
            coalesce(b.quantity_received,0)
            - coalesce(b.quantity_consumed,0)
            - coalesce(b.quantity_transferred,0),
            0
          ) as remaining_qty
        from public.order_item_reservations r
        join public.batches b on b.id = r.batch_id
        where r.order_id = p_order_id
          and r.item_id::text = v_item_id::text
          and r.warehouse_id = p_warehouse_id
          and (v_item_batch_text is null or r.batch_id <> v_item_batch_text::uuid)
          and coalesce(b.status,'active') = 'active'
          and coalesce(b.qc_status,'') = 'released'
          and not exists (
            select 1 from public.batch_recalls br
            where br.batch_id = b.id and br.status = 'active'
          )
          and (
            not coalesce(v_is_food, false)
            or (b.expiry_date is not null and b.expiry_date >= current_date)
          )
        order by b.expiry_date asc nulls last, r.created_at asc, r.batch_id asc
        for update
      loop
        exit when v_needed <= 0;
        v_alloc := least(v_needed, coalesce(v_batch.reserved_qty, 0));
        if v_alloc <= 0 then
          continue;
        end if;

        update public.batches
        set quantity_consumed = quantity_consumed + v_alloc
        where id = v_batch.batch_id
        returning quantity_received, quantity_consumed into v_qr, v_qc;
        if coalesce(v_qc,0) > coalesce(v_qr,0) then
          raise exception 'Over-consumption detected for batch %', v_batch.batch_id;
        end if;

        v_unit_cost := coalesce(v_batch.unit_cost, v_avg_cost, 0);
        v_total_cost := v_alloc * v_unit_cost;
        insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
        values (p_order_id, v_item_id::text, v_alloc, v_unit_cost, v_total_cost, now());

        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
        )
        values (
          v_item_id::text, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
          'orders', p_order_id::text, now(), auth.uid(),
          jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'batchId', v_batch.batch_id),
          v_batch.batch_id,
          p_warehouse_id
        )
        returning id into v_movement_id;

        perform public.post_inventory_movement(v_movement_id);

        update public.order_item_reservations
        set quantity = quantity - v_alloc,
            updated_at = now()
        where id = v_batch.reservation_id;

        delete from public.order_item_reservations
        where id = v_batch.reservation_id
          and quantity <= 0;

        v_needed := v_needed - v_alloc;
      end loop;

      if v_needed > 0 then
        raise exception 'INSUFFICIENT_RESERVED_BATCH_STOCK_FOR_ITEM_%', v_item_id;
      end if;
    else
      if v_item_batch_text is not null then
        select
          b.id as batch_id,
          b.expiry_date,
          b.unit_cost,
          greatest(
            coalesce(b.quantity_received,0)
            - coalesce(b.quantity_consumed,0)
            - coalesce(b.quantity_transferred,0),
            0
          ) as remaining_qty
        into v_batch
        from public.batches b
        where b.id = v_item_batch_text::uuid
          and b.item_id::text = v_item_id::text
          and b.warehouse_id = p_warehouse_id
          and coalesce(b.status,'active') = 'active'
          and coalesce(b.qc_status,'') = 'released'
          and not exists (
            select 1 from public.batch_recalls br
            where br.batch_id = b.id and br.status = 'active'
          )
        for update;
        if not found then
          raise exception 'Batch % not found for item % in warehouse %', v_item_batch_text, v_item_id, p_warehouse_id;
        end if;
        if coalesce(v_is_food, false) and (v_batch.expiry_date is null or v_batch.expiry_date < current_date) then
          raise exception 'NO_VALID_BATCH_AVAILABLE';
        end if;
        v_alloc := least(v_needed, coalesce(v_batch.remaining_qty, 0));
        if v_alloc > 0 then
          update public.batches
          set quantity_consumed = quantity_consumed + v_alloc
          where id = v_batch.batch_id
          returning quantity_received, quantity_consumed into v_qr, v_qc;
          if coalesce(v_qc,0) > coalesce(v_qr,0) then
            raise exception 'Over-consumption detected for batch %', v_batch.batch_id;
          end if;

          v_unit_cost := coalesce(v_batch.unit_cost, v_avg_cost, 0);
          v_total_cost := v_alloc * v_unit_cost;
          insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          values (p_order_id, v_item_id::text, v_alloc, v_unit_cost, v_total_cost, now());

          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
          )
          values (
            v_item_id::text, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'batchId', v_batch.batch_id),
            v_batch.batch_id,
            p_warehouse_id
          )
          returning id into v_movement_id;

          perform public.post_inventory_movement(v_movement_id);

          v_needed := v_needed - v_alloc;
        end if;
      end if;

      for v_batch in
        select
          b.id as batch_id,
          b.expiry_date,
          b.unit_cost,
          greatest(
            coalesce(b.quantity_received,0)
            - coalesce(b.quantity_consumed,0)
            - coalesce(b.quantity_transferred,0),
            0
          ) as remaining_qty
        from public.batches b
        where b.item_id::text = v_item_id::text
          and b.warehouse_id = p_warehouse_id
          and coalesce(b.status,'active') = 'active'
          and coalesce(b.qc_status,'') = 'released'
          and not exists (
            select 1 from public.batch_recalls br
            where br.batch_id = b.id and br.status = 'active'
          )
          and greatest(
            coalesce(b.quantity_received,0)
            - coalesce(b.quantity_consumed,0)
            - coalesce(b.quantity_transferred,0),
            0
          ) > 0
          and (v_item_batch_text is null or b.id <> v_item_batch_text::uuid)
          and (
            not coalesce(v_is_food, false)
            or (b.expiry_date is not null and b.expiry_date >= current_date)
          )
        order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
        for update
      loop
        exit when v_needed <= 0;
        v_alloc := least(v_needed, coalesce(v_batch.remaining_qty, 0));
        if v_alloc <= 0 then
          continue;
        end if;

        update public.batches
        set quantity_consumed = quantity_consumed + v_alloc
        where id = v_batch.batch_id
        returning quantity_received, quantity_consumed into v_qr, v_qc;
        if coalesce(v_qc,0) > coalesce(v_qr,0) then
          raise exception 'Over-consumption detected for batch %', v_batch.batch_id;
        end if;

        v_unit_cost := coalesce(v_batch.unit_cost, v_avg_cost, 0);
        v_total_cost := v_alloc * v_unit_cost;
        insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
        values (p_order_id, v_item_id::text, v_alloc, v_unit_cost, v_total_cost, now());

        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
        )
        values (
          v_item_id::text, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
          'orders', p_order_id::text, now(), auth.uid(),
          jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'batchId', v_batch.batch_id),
          v_batch.batch_id,
          p_warehouse_id
        )
        returning id into v_movement_id;

        perform public.post_inventory_movement(v_movement_id);

        v_needed := v_needed - v_alloc;
      end loop;

      if v_needed > 0 then
        raise exception 'INSUFFICIENT_BATCH_STOCK_FOR_ITEM_%', v_item_id;
      end if;
    end if;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(r.quantity)
          from public.order_item_reservations r
          where r.item_id = v_item_id::text
            and r.warehouse_id = p_warehouse_id
        ), 0),
        available_quantity = coalesce((
          select sum(
            greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
          )
          from public.batches b
          where b.item_id::text = v_item_id::text
            and b.warehouse_id = p_warehouse_id
            and coalesce(b.status,'active') = 'active'
            and coalesce(b.qc_status,'') = 'released'
            and not exists (
              select 1 from public.batch_recalls br
              where br.batch_id = b.id and br.status = 'active'
            )
            and (
              not coalesce(v_is_food, false)
              or (b.expiry_date is not null and b.expiry_date >= current_date)
            )
        ), 0),
        last_updated = now(),
        updated_at = now()
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = p_warehouse_id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.encrypt_text(p_text text)
 RETURNS bytea
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  IF p_text IS NULL OR p_text = '' THEN 
    RETURN NULL;
  END IF;
  RETURN pgp_sym_encrypt(p_text, v_key);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_purchase_items_editability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_status text;
  v_has_receipts boolean;
begin
  v_order_id := coalesce(new.purchase_order_id, old.purchase_order_id);

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = v_order_id;

  if not found then
    raise exception 'purchase order not found';
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = v_order_id)
  into v_has_receipts;

  if tg_op = 'INSERT' then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) then
      raise exception 'cannot add purchase items after receiving';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) or coalesce(old.received_quantity, 0) > 0 then
      raise exception 'cannot delete purchase items after receiving';
    end if;
    return old;
  end if;

  if (new.quantity is distinct from old.quantity)
    or (new.unit_cost is distinct from old.unit_cost)
    or (new.item_id is distinct from old.item_id)
    or (new.purchase_order_id is distinct from old.purchase_order_id)
  then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) or coalesce(old.received_quantity, 0) > 0 then
      raise exception 'cannot modify purchase items after receiving';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_purchase_orders_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_has_receipts boolean;
  v_has_payments boolean;
  v_has_movements boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'cancelled' then
    raise exception 'cannot change status from cancelled';
  end if;

  if new.status = 'draft' then
    raise exception 'cannot revert to draft';
  end if;

  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'cannot change status from completed';
  end if;

  if not (
    (old.status = 'draft' and new.status in ('partial', 'completed', 'cancelled'))
    or (old.status = 'partial' and new.status = 'completed')
  ) then
    raise exception 'invalid status transition';
  end if;

  if new.status = 'cancelled' then
    select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = new.id) into v_has_receipts;
    select exists(
      select 1
      from public.payments p
      where p.reference_table = 'purchase_orders'
        and p.reference_id::text = new.id::text
    ) into v_has_payments;
    select exists(
      select 1
      from public.inventory_movements im
      where (im.reference_table = 'purchase_orders' and im.reference_id::text = new.id::text)
         or (im.data ? 'purchaseOrderId' and im.data->>'purchaseOrderId' = new.id::text)
    ) into v_has_movements;

    if coalesce(v_has_receipts, false)
      or coalesce(v_has_payments, false)
      or coalesce(v_has_movements, false)
      or coalesce(old.paid_amount, 0) > 0
    then
      raise exception 'cannot cancel posted purchase order';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.flag_payment_allocation_status(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pay record;
  v_order record;
  v_delivered_at timestamptz;
  v_is_cod boolean := false;
  v_eligible boolean := false;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  select *
  into v_pay
  from public.payments p
  where p.id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_pay.direction <> 'in' or v_pay.reference_table <> 'orders' then
    return;
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = (v_pay.reference_id)::uuid;
  if not found then
    return;
  end if;
  begin
    select public.order_delivered_at((v_pay.reference_id)::uuid) into v_delivered_at;
  exception when others then
    v_delivered_at := null;
  end;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  v_eligible := (v_delivered_at is not null) and (v_pay.occurred_at >= v_delivered_at) and (not v_is_cod);
  insert into public.ar_payment_status(payment_id, order_id, eligible, allocated, created_at, updated_at)
  values (p_payment_id, (v_pay.reference_id)::uuid, v_eligible, false, now(), now())
  on conflict (payment_id) do update
    set eligible = excluded.eligible,
        updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.general_ledger(p_account_code text, p_start date, p_end date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_date date, journal_entry_id uuid, memo text, source_table text, source_id text, source_event text, debit numeric, credit numeric, amount numeric, running_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with acct as (
    select coa.id, coa.normal_balance
    from public.chart_of_accounts coa
    where coa.code = p_account_code
    limit 1
  ),
  opening as (
    select coalesce(sum(
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end
    ), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where p_start is not null
      and je.entry_date::date < p_start
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  lines as (
    select
      je.entry_date::date as entry_date,
      je.id as journal_entry_id,
      je.memo,
      je.source_table,
      je.source_id,
      je.source_event,
      jl.debit,
      jl.credit,
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end as amount,
      je.created_at as entry_created_at,
      jl.created_at as line_created_at
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    l.entry_date,
    l.journal_entry_id,
    l.memo,
    l.source_table,
    l.source_id,
    l.source_event,
    l.debit,
    l.credit,
    l.amount,
    (select opening_balance from opening)
      + sum(l.amount) over (order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id) as running_balance
  from lines l
  order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_account_id_by_code(p_code text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coa.id
  from public.chart_of_accounts coa
  where coa.code = p_code and coa.is_active = true
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_promotions(p_customer_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_customer_id uuid;
  v_now timestamptz := now();
  v_result jsonb := '[]'::jsonb;
  v_promo record;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  v_customer_id := coalesce(p_customer_id, v_actor);

  for v_promo in
    select p.*
    from public.promotions p
    where p.is_active = true
      and p.approval_status = 'approved'
      and v_now >= p.start_at
      and v_now <= p.end_at
    order by p.end_at asc, p.created_at desc
  loop
    v_result := v_result || public._compute_promotion_price_only(v_promo.id, v_customer_id, 1);
  end loop;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_session_scope()
 RETURNS TABLE(company_id uuid, branch_id uuid, warehouse_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(au.company_id, public.get_default_company_id()) as company_id,
    coalesce(au.branch_id, public.get_default_branch_id()) as branch_id,
    coalesce(au.warehouse_id, public._resolve_default_admin_warehouse_id()) as warehouse_id
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_base_currency()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_settings jsonb;
  v_settings_base text;
  v_currency_base text;
  v_base_count int;
begin
  if to_regclass('public.app_settings') is null or to_regclass('public.currencies') is null then
    raise exception 'base currency configuration tables missing';
  end if;

  select s.data into v_settings
  from public.app_settings s
  where s.id = 'app'
  limit 1;

  if v_settings is null then
    select s.data into v_settings
    from public.app_settings s
    where s.id = 'singleton'
    limit 1;
  end if;

  v_settings_base := upper(nullif(btrim(coalesce(v_settings->'settings'->>'baseCurrency', '')), ''));
  if v_settings_base is null then
    raise exception 'base currency not configured in app_settings';
  end if;

  select count(*) into v_base_count from public.currencies c where c.is_base = true;
  if v_base_count <> 1 then
    raise exception 'invalid base currency state in currencies (count=%)', v_base_count;
  end if;
  select upper(c.code) into v_currency_base from public.currencies c where c.is_base = true limit 1;
  if v_currency_base is null then
    raise exception 'base currency not configured in currencies';
  end if;

  if v_settings_base <> v_currency_base then
    raise exception 'base currency mismatch (app_settings=% , currencies=%)', v_settings_base, v_currency_base;
  end if;

  return v_settings_base;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_batch_recall_orders(p_batch_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, sold_at timestamp with time zone, warehouse_id uuid, branch_id uuid, item_id text, item_name jsonb, batch_id uuid, expiry_date date, supplier_id uuid, supplier_name text, quantity numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._require_staff('get_batch_recall_orders');
  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  return query
  select
    (im.reference_id)::uuid as order_id,
    im.occurred_at as sold_at,
    im.warehouse_id,
    im.branch_id,
    im.item_id::text as item_id,
    coalesce(mi.data->'name', '{}'::jsonb) as item_name,
    im.batch_id,
    b.expiry_date,
    po.supplier_id,
    s.name as supplier_name,
    im.quantity
  from public.inventory_movements im
  join public.menu_items mi on mi.id::text = im.item_id::text
  join public.batches b on b.id = im.batch_id
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.batch_id = p_batch_id
    and (p_warehouse_id is null or im.warehouse_id = p_warehouse_id)
    and (p_branch_id is null or im.branch_id = p_branch_id)
  order by im.occurred_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_catalog_with_stock(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS TABLE(item_id text, name jsonb, unit_type text, status text, price numeric, is_out_of_stock boolean, is_low_stock boolean, data jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    mi.id AS item_id,
    mi.data->'name' AS name,
    mi.unit_type,
    mi.status,
    COALESCE((mi.data->>'price')::numeric, 0) AS price,
    (COALESCE(sm.available_quantity, 0) <= 0) AS is_out_of_stock,
    (COALESCE(sm.available_quantity, 0) <= COALESCE(sm.low_stock_threshold, 5)) AS is_low_stock,
    mi.data AS data
  FROM public.menu_items mi
  LEFT JOIN public.stock_management sm ON sm.item_id::text = mi.id
  WHERE (p_category IS NULL OR mi.category = p_category)
    AND (
      p_search IS NULL OR
      lower(mi.data->'name'->>'ar') LIKE '%' || lower(p_search) || '%' OR
      lower(mi.data->'name'->>'en') LIKE '%' || lower(p_search) || '%'
    )
    AND mi.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.get_cod_audit(p_order_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_payments jsonb;
  v_delivery_entry jsonb;
  v_settlements jsonb;
BEGIN
  IF NOT public.has_admin_permission('accounting.view') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.occurred_at), '[]'::jsonb)
  INTO v_payments
  FROM public.payments p
  WHERE p.reference_table = 'orders'
    AND p.reference_id = p_order_id::text
    AND p.direction = 'in';

  SELECT to_jsonb(le)
  INTO v_delivery_entry
  FROM public.ledger_entries le
  WHERE le.entry_type = 'delivery'
    AND le.reference_type = 'order'
    AND le.reference_id = p_order_id::text
  LIMIT 1;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'settlement', to_jsonb(cs),
      'ledgerEntry', to_jsonb(le),
      'orders', (select coalesce(jsonb_agg(to_jsonb(cso)), '[]'::jsonb) from public.cod_settlement_orders cso where cso.settlement_id = cs.id)
    )
    ORDER BY cs.occurred_at
  ), '[]'::jsonb)
  INTO v_settlements
  FROM public.cod_settlements cs
  LEFT JOIN public.ledger_entries le
    ON le.entry_type = 'settlement' AND le.reference_type = 'settlement' AND le.reference_id = cs.id::text
  WHERE EXISTS (
    SELECT 1 FROM public.cod_settlement_orders cso
    WHERE cso.settlement_id = cs.id AND cso.order_id = p_order_id
  );

  RETURN json_build_object(
    'order', jsonb_build_object('id', v_order.id, 'status', v_order.status, 'data', v_order.data, 'delivery_zone_id', v_order.delivery_zone_id),
    'payments_in', v_payments,
    'delivery_ledger_entry', v_delivery_entry,
    'settlements', v_settlements,
    'cit_balance', (SELECT cash_in_transit_balance FROM public.v_cash_in_transit_balance),
    'reconciliation', (SELECT row_to_json(x) FROM (SELECT * FROM public.v_cod_reconciliation_check) x)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_coupon_by_code(p_code text)
 RETURNS TABLE(id uuid, code text, is_active boolean, data jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.code, c.is_active, c.data
  from public.coupons c
  where lower(c.code) = lower(p_code)
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_customer_credit_summary(p_customer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer record;
  v_balance numeric := 0;
  v_available numeric := 0;
  v_company_id uuid;
begin
  select c.*
  into v_customer
  from public.customers c
  where c.auth_user_id = p_customer_id;

  if not found then
    return json_build_object('exists', false);
  end if;

  select s.company_id into v_company_id
  from public.get_admin_session_scope() s
  limit 1;

  if v_company_id is null then
    v_balance := public.compute_customer_ar_balance(p_customer_id);
    update public.customers
    set current_balance = v_balance,
        updated_at = now()
    where auth_user_id = p_customer_id;
  else
    v_balance := public.compute_customer_ar_balance_in_company(p_customer_id, v_company_id);
  end if;

  v_available := greatest(coalesce(v_customer.credit_limit, 0) - v_balance, 0);

  return json_build_object(
    'exists', true,
    'customer_id', p_customer_id,
    'company_id', v_company_id,
    'customer_type', v_customer.customer_type,
    'payment_terms', v_customer.payment_terms,
    'credit_limit', coalesce(v_customer.credit_limit, 0),
    'current_balance', v_balance,
    'available_credit', v_available
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_daily_sales_stats(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(day_date date, total_sales numeric, order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    eo.date_by::date as day_date,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_default_branch_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.id
  from public.branches b
  where b.is_active = true
  order by b.created_at asc
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_default_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id
  from public.companies c
  where c.is_active = true
  order by c.created_at asc
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_driver_performance_stats(p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS TABLE(driver_id uuid, driver_name text, delivered_count bigint, avg_delivery_minutes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with driver_stats as (
    select
      assigned_delivery_user_id as did,
      count(*) as d_count,
      avg(
        extract(epoch from (
          (data->>'deliveredAt')::timestamptz - (data->>'outForDeliveryAt')::timestamptz
        )) / 60
      ) as avg_mins
    from public.orders
    where status = 'delivered'
      and assigned_delivery_user_id is not null
      and (data->>'outForDeliveryAt') is not null
      and (data->>'deliveredAt') is not null
      and (
        case when (data->'invoiceSnapshot'->>'issuedAt') is not null
             then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
        end
      ) between p_start_date and p_end_date
    group by 1
  )
  select
    ds.did,
    coalesce(au.raw_user_meta_data->>'full_name', au.email, 'Unknown') as d_name,
    ds.d_count,
    ds.avg_mins::numeric
  from driver_stats ds
  left join auth.users au on au.id = ds.did
  order by 3 desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fefo_pricing(p_item_id uuid, p_warehouse_id uuid, p_quantity numeric)
 RETURNS TABLE(batch_id uuid, unit_cost numeric, min_price numeric, suggested_price numeric, batch_code text, expiry_date date, next_batch_min_price numeric, warning_next_batch_price_diff boolean, reason_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_batch record;
  v_next record;
  v_base_price numeric := 0;
  v_total_released numeric := 0;
  v_has_nonexpired boolean := false;
  v_has_nonexpired_unreleased boolean := false;
begin
  if p_item_id is null then
    raise exception 'p_item_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select
    b.id,
    b.cost_per_unit,
    b.min_selling_price,
    b.batch_code,
    b.expiry_date,
    greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
  into v_batch
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
    and coalesce(b.qc_status,'released') = 'released'
  order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
  limit 1;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
  ) into v_has_nonexpired;

  select exists(
    select 1
    from public.batches b
    where b.item_id::text = p_item_id::text
      and b.warehouse_id = p_warehouse_id
      and coalesce(b.status, 'active') = 'active'
      and (b.expiry_date is null or b.expiry_date >= current_date)
      and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      and coalesce(b.qc_status,'released') <> 'released'
  ) into v_has_nonexpired_unreleased;

  if v_batch.id is null then
    if v_has_nonexpired_unreleased then
      reason_code := 'BATCH_NOT_RELEASED';
    else
      reason_code := 'NO_VALID_BATCH';
    end if;
    batch_id := null;
    unit_cost := 0;
    min_price := 0;
    suggested_price := 0;
    batch_code := null;
    expiry_date := null;
    next_batch_min_price := null;
    warning_next_batch_price_diff := false;
    return next;
  end if;

  select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
  into v_total_released
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and coalesce(b.qc_status,'released') = 'released';

  if v_total_released + 1e-9 < v_qty then
    reason_code := 'INSUFFICIENT_BATCH_QUANTITY';
  else
    reason_code := null;
  end if;

  v_base_price := public.get_item_price_with_discount(p_item_id::text, null::uuid, v_qty);

  batch_id := v_batch.id;
  unit_cost := coalesce(v_batch.cost_per_unit, 0);
  min_price := coalesce(v_batch.min_selling_price, 0);
  suggested_price := greatest(coalesce(v_base_price, 0), coalesce(v_batch.min_selling_price, 0));
  batch_code := v_batch.batch_code;
  expiry_date := v_batch.expiry_date;

  select
    b.min_selling_price
  into v_next
  from public.batches b
  where b.item_id::text = p_item_id::text
    and b.warehouse_id = p_warehouse_id
    and coalesce(b.status, 'active') = 'active'
    and (b.expiry_date is null or b.expiry_date >= current_date)
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
    and coalesce(b.qc_status,'released') = 'released'
    and b.id <> v_batch.id
  order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
  limit 1;

  next_batch_min_price := nullif(coalesce(v_next.min_selling_price, null), null);
  warning_next_batch_price_diff :=
    case
      when next_batch_min_price is null then false
      else abs(next_batch_min_price - min_price) > 1e-9
    end;

  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fefo_pricing(p_item_id uuid, p_warehouse_id uuid, p_quantity numeric, p_customer_id uuid)
 RETURNS TABLE(batch_id uuid, unit_cost numeric, min_price numeric, suggested_price numeric, batch_code text, expiry_date date, next_batch_min_price numeric, warning_next_batch_price_diff boolean, reason_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qty numeric := greatest(coalesce(p_quantity, 0), 0);
  v_base_price numeric := 0;
  v_row record;
begin
  if v_qty <= 0 then
    v_qty := 1;
  end if;

  select * into v_row from public.get_fefo_pricing(p_item_id, p_warehouse_id, v_qty);
  batch_id := v_row.batch_id;
  unit_cost := v_row.unit_cost;
  min_price := v_row.min_price;
  batch_code := v_row.batch_code;
  expiry_date := v_row.expiry_date;
  next_batch_min_price := v_row.next_batch_min_price;
  warning_next_batch_price_diff := v_row.warning_next_batch_price_diff;
  reason_code := v_row.reason_code;

  if batch_id is null then
    suggested_price := 0;
    return next;
  end if;

  v_base_price := public.get_item_price_with_discount(p_item_id::text, p_customer_id, v_qty);
  suggested_price := greatest(coalesce(v_base_price, 0), coalesce(min_price, 0));
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_expired_in_stock_alert()
 RETURNS TABLE(item_id text, item_name text, batch_id uuid, warehouse_id uuid, warehouse_code text, warehouse_name text, expiry_date date, days_expired integer, qty_remaining numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with wh as (
    select w.id, w.code, w.name
    from public.warehouses w
    where w.code = 'MAIN'
    limit 1
  )
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    wh.id as warehouse_id,
    wh.code as warehouse_code,
    wh.name as warehouse_name,
    b.expiry_date,
    (current_date - b.expiry_date)::int as days_expired,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  cross join wh
  where mi.category = 'food'
    and b.expiry_date is not null
    and b.remaining_qty > 0
    and b.expiry_date < current_date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_near_expiry_alert(p_threshold_days integer DEFAULT 7)
 RETURNS TABLE(item_id text, item_name text, batch_id uuid, warehouse_id uuid, warehouse_code text, warehouse_name text, expiry_date date, days_remaining integer, qty_remaining numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with wh as (
    select w.id, w.code, w.name
    from public.warehouses w
    where w.code = 'MAIN'
    limit 1
  )
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    wh.id as warehouse_id,
    wh.code as warehouse_code,
    wh.name as warehouse_name,
    b.expiry_date,
    (b.expiry_date - current_date)::int as days_remaining,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  cross join wh
  where mi.category = 'food'
    and b.expiry_date is not null
    and b.remaining_qty > 0
    and b.expiry_date >= current_date
    and b.expiry_date <= current_date + greatest(coalesce(p_threshold_days, 0), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_reservation_block_reason(p_item_id text DEFAULT NULL::text)
 RETURNS TABLE(item_id text, item_name text, batch_id uuid, expiry_date date, days_from_today integer, qty_remaining numeric, reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    b.expiry_date,
    case
      when b.expiry_date is null then null
      else (b.expiry_date - current_date)::int
    end as days_from_today,
    b.remaining_qty as qty_remaining,
    case
      when b.expiry_date is null then 'missing_expiry'
      when b.expiry_date < current_date then 'expired'
      else 'ok'
    end as reason
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  where mi.category = 'food'
    and b.remaining_qty > 0
    and (
      b.expiry_date is null
      or b.expiry_date < current_date
    )
    and (p_item_id is null or b.item_id = p_item_id);
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_sales_movements_report(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_warehouse_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, sold_at timestamp with time zone, warehouse_id uuid, branch_id uuid, item_id text, item_name jsonb, batch_id uuid, expiry_date date, supplier_id uuid, supplier_name text, quantity numeric, unit_cost numeric, total_cost numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._require_staff('get_food_sales_movements_report');

  return query
  select
    (im.reference_id)::uuid as order_id,
    im.occurred_at as sold_at,
    im.warehouse_id,
    im.branch_id,
    im.item_id::text as item_id,
    coalesce(mi.data->'name', '{}'::jsonb) as item_name,
    im.batch_id,
    b.expiry_date,
    po.supplier_id,
    s.name as supplier_name,
    im.quantity,
    im.unit_cost,
    im.total_cost
  from public.inventory_movements im
  join public.menu_items mi on mi.id::text = im.item_id::text
  join public.batches b on b.id = im.batch_id
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and coalesce(mi.category,'') = 'food'
    and (p_warehouse_id is null or im.warehouse_id = p_warehouse_id)
    and (p_branch_id is null or im.branch_id = p_branch_id)
  order by im.occurred_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_currency text;
  v_type text;
  v_date date;
  v_base text;
  v_rate numeric;
  v_base_high boolean := false;
begin
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_date := coalesce(p_date, current_date);
  v_base := public.get_base_currency();

  if v_type is null then
    v_type := 'operational';
  end if;
  if v_currency is null then
    v_currency := v_base;
  end if;

  if v_currency = v_base then
    if v_type = 'accounting' then
      select coalesce(c.is_high_inflation, false)
      into v_base_high
      from public.currencies c
      where upper(c.code) = upper(v_base)
      limit 1;
      if v_base_high then
        select fr.rate
        into v_rate
        from public.fx_rates fr
        where upper(fr.currency_code) = v_base
          and fr.rate_type = v_type
          and fr.rate_date <= v_date
        order by fr.rate_date desc
        limit 1;
        return v_rate;
      end if;
    end if;
    return 1;
  end if;

  select fr.rate
  into v_rate
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date <= v_date
  order by fr.rate_date desc
  limit 1;

  return v_rate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_hourly_sales_stats(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(hour_of_day integer, total_sales numeric, order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    extract(hour from eo.date_by)::int as hour_of_day,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_invoice_audit(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_order record;
  v_invoice_snapshot jsonb;
  v_journal_entry_id uuid;
  v_promotions jsonb;
  v_manual_discount numeric := 0;
  v_discount_type text := 'None';
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select o.*, o.data->'invoiceSnapshot' as invoice_snapshot
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  if not (
    public.is_admin()
    or public.has_admin_permission('orders.view')
    or v_order.customer_auth_user_id = v_actor
  ) then
    raise exception 'not authorized';
  end if;

  v_invoice_snapshot := coalesce(v_order.invoice_snapshot, '{}'::jsonb);

  select je.id
  into v_journal_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event = 'delivered'
  order by je.created_at desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'promotionUsageId', pu.id::text,
        'promotionLineId', pu.promotion_line_id::text,
        'promotionId', pu.promotion_id::text,
        'promotionName', coalesce(nullif(pu.snapshot->>'name',''), pr.name),
        'approvalRequestId', case when pr.approval_request_id is null then null else pr.approval_request_id::text end,
        'approvalStatus', pr.approval_status,
        'bundleQty', pu.bundle_qty,
        'computedOriginalTotal', nullif(pu.snapshot->>'computedOriginalTotal','')::numeric,
        'finalTotal', nullif(pu.snapshot->>'finalTotal','')::numeric,
        'promotionExpense', nullif(pu.snapshot->>'promotionExpense','')::numeric
      )
      order by pu.created_at asc
    ),
    '[]'::jsonb
  )
  into v_promotions
  from public.promotion_usage pu
  left join public.promotions pr on pr.id = pu.promotion_id
  where pu.order_id = p_order_id;

  v_manual_discount := coalesce(
    nullif(v_invoice_snapshot->>'discountAmount','')::numeric,
    nullif(v_order.data->>'discountAmount','')::numeric,
    0
  );

  if jsonb_typeof(v_promotions) = 'array' and jsonb_array_length(v_promotions) > 0 then
    v_discount_type := 'Promotion';
  elsif v_manual_discount > 0 then
    v_discount_type := 'Manual Discount';
  end if;

  return jsonb_build_object(
    'orderId', p_order_id::text,
    'invoiceNumber', coalesce(
      nullif(v_invoice_snapshot->>'invoiceNumber',''),
      nullif(v_order.invoice_number,'')
    ),
    'invoiceIssuedAt', nullif(v_invoice_snapshot->>'issuedAt',''),
    'discountType', v_discount_type,
    'manualDiscountAmount', v_manual_discount,
    'manualDiscountApprovalRequestId', case when v_order.discount_approval_request_id is null then null else v_order.discount_approval_request_id::text end,
    'manualDiscountApprovalStatus', v_order.discount_approval_status,
    'promotions', v_promotions,
    'journalEntryId', case when v_journal_entry_id is null then null else v_journal_entry_id::text end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_item_batches(p_item_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(batch_id uuid, occurred_at timestamp with time zone, unit_cost numeric, received_quantity numeric, consumed_quantity numeric, remaining_quantity numeric, qc_status text, last_qc_result text, last_qc_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
begin
  perform public._require_staff('get_item_batches');

  v_wh := coalesce(p_warehouse_id, public._resolve_default_admin_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  return query
  select
    b.id as batch_id,
    max(im.occurred_at) as occurred_at,
    max(im.unit_cost) as unit_cost,
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end) as received_quantity,
    sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end) as consumed_quantity,
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end)
      - sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end) as remaining_quantity,
    coalesce(b.qc_status,'released') as qc_status,
    q.last_result as last_qc_result,
    q.last_at as last_qc_at
  from public.inventory_movements im
  join public.batches b on b.id = im.batch_id
  left join lateral (
    select qc.result as last_result, qc.checked_at as last_at
    from public.qc_checks qc
    where qc.batch_id = b.id
      and qc.check_type = 'inspection'
    order by qc.checked_at desc
    limit 1
  ) q on true
  where b.item_id::uuid = p_item_id
    and b.warehouse_id = v_wh
    and im.batch_id is not null
  group by b.id, b.qc_status, q.last_result, q.last_at
  having (
    sum(case when im.movement_type = 'purchase_in' then im.quantity else 0 end)
      - sum(case when im.movement_type = 'sale_out' then im.quantity else 0 end)
  ) > 0
  order by occurred_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_item_price_with_discount(p_item_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_quantity numeric DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_type text := 'retail';
  v_special_price numeric;
  v_tier_price numeric;
  v_tier_discount numeric;
  v_base_unit_price numeric;
  v_unit_type text;
  v_price_per_unit numeric;
  v_final_unit_price numeric;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'p_item_id is required';
  END IF;
  
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    p_quantity := 1;
  END IF;

  SELECT
    COALESCE(mi.unit_type, 'piece'),
    COALESCE(NULLIF((mi.data->>'pricePerUnit')::numeric, NULL), 0),
    COALESCE(NULLIF((mi.data->>'price')::numeric, NULL), mi.price, 0)
  INTO v_unit_type, v_price_per_unit, v_base_unit_price
  FROM public.menu_items mi
  WHERE mi.id::text = p_item_id::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_id;
  END IF;

  IF v_unit_type = 'gram' AND COALESCE(v_price_per_unit, 0) > 0 THEN
    v_base_unit_price := v_price_per_unit / 1000;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT COALESCE(c.customer_type, 'retail')
    INTO v_customer_type
    FROM public.customers c
    WHERE c.auth_user_id::text = p_customer_id::text;

    IF NOT FOUND THEN
      v_customer_type := 'retail';
    END IF;

    SELECT csp.special_price
    INTO v_special_price
    FROM public.customer_special_prices csp
    WHERE csp.customer_id::text = p_customer_id::text
      AND csp.item_id::text = p_item_id::text
      AND csp.is_active = true
      AND (csp.valid_from IS NULL OR csp.valid_from <= now())
      AND (csp.valid_to IS NULL OR csp.valid_to >= now())
    ORDER BY csp.created_at DESC
    LIMIT 1;

    IF v_special_price IS NOT NULL THEN
      RETURN v_special_price;
    END IF;
  END IF;

  SELECT pt.price, pt.discount_percentage
  INTO v_tier_price, v_tier_discount
  FROM public.price_tiers pt
  WHERE pt.item_id::text = p_item_id::text
    AND pt.customer_type = v_customer_type
    AND pt.is_active = true
    AND pt.min_quantity <= p_quantity
    AND (pt.max_quantity IS NULL OR pt.max_quantity >= p_quantity)
    AND (pt.valid_from IS NULL OR pt.valid_from <= now())
    AND (pt.valid_to IS NULL OR pt.valid_to >= now())
  ORDER BY pt.min_quantity DESC
  LIMIT 1;

  IF v_tier_price IS NOT NULL AND v_tier_price > 0 THEN
    v_final_unit_price := v_tier_price;
  ELSE
    v_final_unit_price := v_base_unit_price;
    IF COALESCE(v_tier_discount, 0) > 0 THEN
      v_final_unit_price := v_base_unit_price * (1 - (LEAST(100, GREATEST(0, v_tier_discount)) / 100));
    END IF;
  END IF;

  RETURN COALESCE(v_final_unit_price, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_open_reservations_report(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_warehouse_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS TABLE(order_id uuid, order_status text, order_created_at timestamp with time zone, order_source text, customer_name text, delivery_zone_id uuid, delivery_zone_name text, item_id text, item_name jsonb, reserved_quantity numeric, warehouse_id uuid, warehouse_name text, reservation_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_search text;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'start and end dates are required';
  end if;

  v_search := nullif(trim(p_search), '');

  return query
  with base as (
    select
      r.order_id,
      o.status::text as order_status,
      o.created_at as order_created_at,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
      coalesce(nullif(o.data->>'customerName',''), '') as customer_name,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as delivery_zone_id,
      r.item_id,
      r.quantity as reserved_quantity,
      r.warehouse_id,
      r.updated_at as reservation_updated_at
    from public.order_item_reservations r
    join public.orders o on o.id = r.order_id
    where r.quantity > 0
      and o.status not in ('delivered','cancelled')
      and o.created_at >= p_start_date
      and o.created_at <= p_end_date
      and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id)
  )
  select
    b.order_id,
    b.order_status,
    b.order_created_at,
    b.order_source,
    b.customer_name,
    b.delivery_zone_id,
    coalesce(dz.name, '') as delivery_zone_name,
    b.item_id,
    coalesce(mi.data->'name', jsonb_build_object('ar', b.item_id)) as item_name,
    b.reserved_quantity,
    b.warehouse_id,
    coalesce(w.name, '') as warehouse_name,
    b.reservation_updated_at
  from base b
  left join public.delivery_zones dz on dz.id = b.delivery_zone_id
  left join public.warehouses w on w.id = b.warehouse_id
  left join public.menu_items mi on mi.id::text = b.item_id
  where (
    v_search is null
    or right(b.order_id::text, 6) ilike '%' || v_search || '%'
    or b.customer_name ilike '%' || v_search || '%'
    or coalesce(w.name, '') ilike '%' || v_search || '%'
    or coalesce(dz.name, '') ilike '%' || v_search || '%'
    or b.item_id ilike '%' || v_search || '%'
    or coalesce(mi.data->'name'->>'ar', '') ilike '%' || v_search || '%'
    or coalesce(mi.data->'name'->>'en', '') ilike '%' || v_search || '%'
  )
  order by b.reservation_updated_at desc, b.order_created_at desc
  limit greatest(1, least(p_limit, 20000))
  offset greatest(0, p_offset);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_or_create_uom(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  select id into v_id from public.uom where code = p_code limit 1;
  if v_id is null then
    insert into public.uom(code, name) values (p_code, p_code) returning id into v_id;
  end if;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_customer_type(p_order_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.customer_type
  from public.orders o
  join public.customers c
    on c.auth_user_id::text = coalesce(o.customer_auth_user_id::text, nullif(o.data->>'customerId',''))
  where o.id = p_order_id
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_item_reservations(p_order_id uuid)
 RETURNS TABLE(item_id text, warehouse_id uuid, quantity numeric, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_owner uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.customer_auth_user_id into v_owner
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_staff() and v_owner <> v_actor then
    raise exception 'not allowed';
  end if;

  return query
  select r.item_id, r.warehouse_id, r.quantity, r.created_at, r.updated_at
  from public.order_item_reservations r
  where r.order_id = p_order_id
  order by r.created_at asc, r.item_id asc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_source_revenue(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(source text, total_sales numeric, order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    case when eo.order_source = 'in_store' then 'in_store' else 'online' end as source,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 2 desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_payment_method_stats(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(method text, total_sales numeric, order_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      coalesce(o.data->>'paymentMethod', 'unknown') as method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    eo.method,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.method <> 'cash')
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by eo.method
  order by 2 desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pos_offline_sales_dashboard(p_state text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(offline_id text, order_id uuid, warehouse_id uuid, state text, created_by uuid, created_at timestamp with time zone, synced_at timestamp with time zone, updated_at timestamp with time zone, last_error text, reconciliation_status text, reconciliation_approval_request_id uuid, reconciled_by uuid, reconciled_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view')) then
    raise exception 'not authorized';
  end if;

  return query
  select
    s.offline_id,
    s.order_id,
    s.warehouse_id,
    s.state,
    s.created_by,
    s.created_at,
    case when s.state = 'CREATED_OFFLINE' then null else s.updated_at end as synced_at,
    s.updated_at,
    s.last_error,
    s.reconciliation_status,
    s.reconciliation_approval_request_id,
    s.reconciled_by,
    s.reconciled_at
  from public.pos_offline_sales s
  where (p_state is null or s.state = p_state)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_product_sales_report_v9(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(item_id text, item_name jsonb, unit_type text, quantity_sold numeric, total_sales numeric, total_cost numeric, total_profit numeric, current_stock numeric, reserved_stock numeric, current_cost_price numeric, avg_inventory numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      nullif(o.data->>'paidAt','')::timestamptz as paid_at,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective,
      o.data
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  ),
  sales_orders as (
    select
      eo.*,
      coalesce(
        nullif(eo.data->>'discountAmount','')::numeric,
        nullif(eo.data->>'discountTotal','')::numeric,
        nullif(eo.data->>'discount','')::numeric,
        0
      ) as discount_amount,
      coalesce(nullif(eo.data->>'subtotal','')::numeric, 0) as subtotal_amount
    from effective_orders eo
    where (
        eo.paid_at is not null
        or (eo.status = 'delivered' and eo.payment_method <> 'cash')
    )
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
      so.id as order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type,
      mi_res.resolved_name as resolved_name
    from sales_orders so
    cross join lateral jsonb_array_elements(
      case
        when p_invoice_only then
          case
            when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array'
                 and jsonb_array_length(so.data->'invoiceSnapshot'->'items') > 0 then so.data->'invoiceSnapshot'->'items'
            else '[]'::jsonb
          end
        else
          case
            when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array'
                 and jsonb_array_length(so.data->'invoiceSnapshot'->'items') > 0 then so.data->'invoiceSnapshot'->'items'
            when jsonb_typeof(so.data->'items') = 'array' then so.data->'items'
            else '[]'::jsonb
          end
      end
    ) as item
    left join lateral (
      select
        mi.id::text as resolved_id,
        mi.unit_type as resolved_unit_type,
        mi.data->'name' as resolved_name
      from public.menu_items mi
      where (
        (item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = item->'name'->>'ar')
        or (item->'name'->>'en' is not null and mi.data->'name'->>'en' = item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_items as (
    select
      ei.order_id,
      coalesce(
        nullif(ei.item->>'itemId', ''),
        nullif(ei.item->>'id', ''),
        nullif(ei.item->>'menuItemId', ''),
        nullif(ei.resolved_item_id, '')
      ) as item_id_text,
      coalesce(ei.item->'name', ei.resolved_name) as item_name,
      coalesce(
        nullif(ei.item->>'unitType', ''),
        nullif(ei.item->>'unit', ''),
        nullif(ei.resolved_unit_type, ''),
        'piece'
      ) as unit_type,
      coalesce(nullif(ei.item->>'quantity', '')::numeric, 0) as quantity,
      coalesce(nullif(ei.item->>'weight', '')::numeric, 0) as weight,
      coalesce(nullif(ei.item->>'price', '')::numeric, 0) as price,
      coalesce(nullif(ei.item->>'pricePerUnit', '')::numeric, 0) as price_per_unit,
      ei.item->'selectedAddons' as addons,
      case
        when jsonb_typeof(ei.item->'selectedAddons') = 'object' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_each(ei.item->'selectedAddons') as a(key, addon_value)
        ), 0)
        when jsonb_typeof(ei.item->'selectedAddons') = 'array' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_array_elements(ei.item->'selectedAddons') as addon_value
        ), 0)
        else 0
      end as addons_total
    from expanded_items ei
  ),
  order_item_gross as (
    select
      ni.order_id,
      ni.item_id_text,
      max(ni.item_name::text) as any_name,
      max(ni.unit_type) as any_unit,
      sum(
        case
          when ni.unit_type in ('kg', 'gram') and ni.weight > 0
            then (ni.weight * greatest(ni.quantity, 1))
          else greatest(ni.quantity, 0)
        end
      ) as qty_sold,
      sum(
        (
          (
            case
              when ni.unit_type = 'gram'
                   and ni.price_per_unit > 0
                   and ni.weight > 0 then (ni.price_per_unit / 1000.0) * ni.weight
              when ni.unit_type in ('kg', 'gram')
                   and ni.weight > 0 then ni.price * ni.weight
              else ni.price
            end
            + ni.addons_total
          )
          *
          case
            when ni.unit_type in ('kg', 'gram') and ni.weight > 0
              then greatest(ni.quantity, 1)
            else greatest(ni.quantity, 0)
          end
        )
      ) as line_gross
    from normalized_items ni
    where nullif(ni.item_id_text, '') is not null
    group by ni.order_id, ni.item_id_text
  ),
  order_totals as (
    select
      so.id as order_id,
      coalesce(sum(oig.line_gross), 0) as items_gross_sum,
      max(so.discount_amount) as discount_amount,
      max(so.subtotal_amount) as subtotal_amount
    from sales_orders so
    left join order_item_gross oig on oig.order_id = so.id
    group by so.id
  ),
  order_scaling as (
    select
      ot.order_id,
      greatest(coalesce(ot.items_gross_sum, 0), 0) as items_gross_sum,
      greatest(coalesce(ot.subtotal_amount, 0), 0) as subtotal_amount,
      greatest(coalesce(ot.discount_amount, 0), 0) as discount_amount,
      greatest(
        case
          when coalesce(ot.subtotal_amount, 0) > 0 then ot.subtotal_amount
          else coalesce(ot.items_gross_sum, 0)
        end,
        0
      ) as base_amount,
      case
        when coalesce(ot.subtotal_amount, 0) > 0 and coalesce(ot.items_gross_sum, 0) > 0
          then (ot.subtotal_amount / ot.items_gross_sum)
        else 1
      end as scale_to_subtotal
    from order_totals ot
  ),
  order_item_net as (
    select
      oig.order_id,
      oig.item_id_text,
      max(oig.any_name) as any_name,
      max(oig.any_unit) as any_unit,
      sum(oig.qty_sold) as qty_sold,
      sum(
        greatest(
          (oig.line_gross * os.scale_to_subtotal)
          - (least(os.discount_amount, os.base_amount) * ((oig.line_gross * os.scale_to_subtotal) / nullif(os.base_amount, 0))),
          0
        )
      ) as net_sales
    from order_item_gross oig
    join order_scaling os on os.order_id = oig.order_id
    group by oig.order_id, oig.item_id_text
  ),
  sales_lines as (
    select
      oin.item_id_text,
      max(oin.any_name) as any_name,
      max(oin.any_unit) as any_unit,
      sum(coalesce(oin.qty_sold, 0)) as qty_sold,
      sum(coalesce(oin.net_sales, 0)) as net_sales
    from order_item_net oin
    group by oin.item_id_text
  ),
  returns_base as (
    select
      sr.id as return_id,
      sr.order_id,
      sr.total_refund_amount as return_amount,
      sr.items as items,
      o.data as order_data,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as discount_amount,
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as subtotal_amount
    from public.sales_returns sr
    join public.orders o on o.id = sr.order_id
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
  ),
  returns_items as (
    select
      rb.return_id,
      rb.order_id,
      rb.return_amount,
      coalesce(nullif(ri->>'itemId',''), nullif(ri->>'id','')) as item_id_text,
      coalesce(nullif(ri->>'quantity','')::numeric, 0) as qty_returned
    from returns_base rb
    cross join lateral jsonb_array_elements(coalesce(rb.items, '[]'::jsonb)) as ri
    where coalesce(nullif(ri->>'quantity','')::numeric, 0) > 0
  ),
  return_expanded_items as (
    select
      rb.order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type
    from returns_base rb
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(rb.order_data->'invoiceSnapshot'->'items') = 'array'
             and jsonb_array_length(rb.order_data->'invoiceSnapshot'->'items') > 0 then rb.order_data->'invoiceSnapshot'->'items'
        when jsonb_typeof(rb.order_data->'items') = 'array' then rb.order_data->'items'
        else '[]'::jsonb
      end
    ) as item
    left join lateral (
      select
        mi.id::text as resolved_id,
        mi.unit_type as resolved_unit_type
      from public.menu_items mi
      where (
        (item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = item->'name'->>'ar')
        or (item->'name'->>'en' is not null and mi.data->'name'->>'en' = item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_return_items as (
    select
      rei.order_id,
      coalesce(
        nullif(rei.item->>'itemId', ''),
        nullif(rei.item->>'id', ''),
        nullif(rei.item->>'menuItemId', ''),
        nullif(rei.resolved_item_id, '')
      ) as item_id_text,
      coalesce(nullif(rei.item->>'unitType', ''), nullif(rei.item->>'unit', ''), nullif(rei.resolved_unit_type, ''), 'piece') as unit_type,
      coalesce(nullif(rei.item->>'quantity', '')::numeric, 0) as quantity,
      coalesce(nullif(rei.item->>'weight', '')::numeric, 0) as weight,
      coalesce(nullif(rei.item->>'price', '')::numeric, 0) as price,
      coalesce(nullif(rei.item->>'pricePerUnit', '')::numeric, 0) as price_per_unit,
      case
        when jsonb_typeof(rei.item->'selectedAddons') = 'object' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_each(rei.item->'selectedAddons') as a(key, addon_value)
        ), 0)
        when jsonb_typeof(rei.item->'selectedAddons') = 'array' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_array_elements(rei.item->'selectedAddons') as addon_value
        ), 0)
        else 0
      end as addons_total
    from return_expanded_items rei
  ),
  return_order_item_gross as (
    select
      nri.order_id,
      nri.item_id_text,
      sum(
        case
          when nri.unit_type in ('kg', 'gram') and nri.weight > 0
            then (nri.weight * greatest(nri.quantity, 1))
          else greatest(nri.quantity, 0)
        end
      ) as qty_stock,
      sum(
        (
          (
            case
              when nri.unit_type = 'gram'
                   and nri.price_per_unit > 0
                   and nri.weight > 0 then (nri.price_per_unit / 1000.0) * nri.weight
              when nri.unit_type in ('kg', 'gram')
                   and nri.weight > 0 then nri.price * nri.weight
              else nri.price
            end
            + nri.addons_total
          )
          *
          case
            when nri.unit_type in ('kg', 'gram') and nri.weight > 0
              then greatest(nri.quantity, 1)
            else greatest(nri.quantity, 0)
          end
        )
      ) as line_gross
    from normalized_return_items nri
    where nullif(nri.item_id_text,'') is not null
    group by nri.order_id, nri.item_id_text
  ),
  return_order_totals as (
    select
      rb.order_id,
      coalesce(sum(roig.line_gross), 0) as items_gross_sum,
      max(rb.discount_amount) as discount_amount,
      max(rb.subtotal_amount) as subtotal_amount
    from returns_base rb
    left join return_order_item_gross roig on roig.order_id = rb.order_id
    group by rb.order_id
  ),
  return_order_scaling as (
    select
      rot.order_id,
      greatest(coalesce(rot.items_gross_sum, 0), 0) as items_gross_sum,
      greatest(coalesce(rot.subtotal_amount, 0), 0) as subtotal_amount,
      greatest(coalesce(rot.discount_amount, 0), 0) as discount_amount,
      greatest(
        case
          when coalesce(rot.subtotal_amount, 0) > 0 then rot.subtotal_amount
          else coalesce(rot.items_gross_sum, 0)
        end,
        0
      ) as base_amount,
      case
        when coalesce(rot.subtotal_amount, 0) > 0 and coalesce(rot.items_gross_sum, 0) > 0
          then (rot.subtotal_amount / rot.items_gross_sum)
        else 1
      end as scale_to_subtotal
    from return_order_totals rot
  ),
  return_order_item_net as (
    select
      roig.order_id,
      roig.item_id_text,
      roig.qty_stock,
      greatest(
        (roig.line_gross * ros.scale_to_subtotal)
        - (least(ros.discount_amount, ros.base_amount) * ((roig.line_gross * ros.scale_to_subtotal) / nullif(ros.base_amount, 0))),
        0
      ) as net_sales_amount
    from return_order_item_gross roig
    join return_order_scaling ros on ros.order_id = roig.order_id
  ),
  return_item_gross_value as (
    select
      ri.return_id,
      ri.order_id,
      ri.item_id_text,
      ri.qty_returned,
      ri.return_amount,
      case
        when roin.qty_stock > 0
          then (ri.qty_returned * (roin.net_sales_amount / roin.qty_stock))
        else 0
      end as gross_value
    from returns_items ri
    left join return_order_item_net roin
      on roin.order_id = ri.order_id
     and roin.item_id_text = ri.item_id_text
  ),
  return_scaling as (
    select
      rigv.return_id,
      max(rigv.return_amount) as return_amount,
      sum(rigv.gross_value) as gross_value_sum
    from return_item_gross_value rigv
    group by rigv.return_id
  ),
  returns_sales as (
    select
      rigv.item_id_text,
      sum(rigv.qty_returned) as qty_returned,
      sum(
        case
          when rs.gross_value_sum > 0
            then rigv.gross_value * (rs.return_amount / rs.gross_value_sum)
          else 0
        end
      ) as returned_sales
    from return_item_gross_value rigv
    join return_scaling rs on rs.return_id = rigv.return_id
    group by rigv.item_id_text
  ),
  returns_cost as (
    select
      im.item_id::text as item_id_text,
      sum(im.quantity) as qty_returned_cost,
      sum(im.total_cost) as returned_cost
    from public.inventory_movements im
    where im.reference_table = 'sales_returns'
      and im.movement_type = 'return_in'
      and im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
      and (
        p_zone_id is null or exists (
          select 1 from public.orders o
          where o.id::text = (im.data->>'orderId')
            and coalesce(
              o.delivery_zone_id,
              case
                when nullif(o.data->>'deliveryZoneId','') is not null
                     and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then (o.data->>'deliveryZoneId')::uuid
                else null
              end
            ) = p_zone_id
        )
      )
    group by im.item_id::text
  ),
  cogs_gross as (
    select
      oic.item_id::text as item_id_text,
      sum(oic.total_cost) as gross_cost
    from public.order_item_cogs oic
    join sales_orders so on so.id = oic.order_id
    group by oic.item_id::text
  ),
  period_movements as (
    select
      im.item_id::text as item_id_text,
      sum(case when im.movement_type in ('purchase_in','adjust_in','return_in') then im.quantity else 0 end)
      -
      sum(case when im.movement_type in ('sale_out','wastage_out','adjust_out','return_out') then im.quantity else 0 end)
      as net_qty_period
    from public.inventory_movements im
    where im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
    group by im.item_id::text
  ),
  item_keys as (
    select item_id_text from sales_lines
    union
    select item_id_text from returns_sales
    union
    select item_id_text from returns_cost
    union
    select item_id_text from cogs_gross
  )
  select
    k.item_id_text as item_id,
    coalesce(mi.data->'name', sl.any_name::jsonb, jsonb_build_object('ar', k.item_id_text)) as item_name,
    coalesce(nullif(mi.unit_type, ''), nullif(sl.any_unit, ''), 'piece') as unit_type,
    greatest(coalesce(sl.qty_sold, 0) - coalesce(rs.qty_returned, 0), 0) as quantity_sold,
    greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0) as total_sales,
    greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0) as total_cost,
    (
      greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0)
      - greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0)
    ) as total_profit,
    coalesce(sm.available_quantity, 0) as current_stock,
    coalesce(sm.reserved_quantity, 0) as reserved_stock,
    coalesce(sm.avg_cost, mi.cost_price, 0) as current_cost_price,
    (
      (
        greatest(
          coalesce(sm.available_quantity, 0) - coalesce(pm.net_qty_period, 0),
          0
        )
        + coalesce(sm.available_quantity, 0)
      ) / 2.0
    ) as avg_inventory
  from item_keys k
  left join public.menu_items mi on mi.id::text = k.item_id_text
  left join sales_lines sl on sl.item_id_text = k.item_id_text
  left join returns_sales rs on rs.item_id_text = k.item_id_text
  left join returns_cost rc on rc.item_id_text = k.item_id_text
  left join cogs_gross cg on cg.item_id_text = k.item_id_text
  left join public.stock_management sm on sm.item_id::text = k.item_id_text
  left join period_movements pm on pm.item_id_text = k.item_id_text
  where (coalesce(sl.qty_sold, 0) + coalesce(rs.qty_returned, 0) + coalesce(rc.qty_returned_cost, 0)) > 0
  order by total_sales desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_promotion_expense_drilldown(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_min_amount numeric DEFAULT 0)
 RETURNS TABLE(entry_date timestamp with time zone, journal_entry_id uuid, order_id uuid, invoice_number text, debit numeric, credit numeric, amount numeric, promotion_usage_ids uuid[], promotion_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not authorized';
  end if;

  return query
  with promo_usage as (
    select
      pu.order_id,
      array_agg(pu.id) as usage_ids,
      array_agg(distinct pu.promotion_id) as promo_ids
    from public.promotion_usage pu
    group by pu.order_id
  ),
  promo_account as (
    select coa.id
    from public.chart_of_accounts coa
    where coa.code = '6150' and coa.is_active = true
    limit 1
  )
  select
    je.entry_date,
    je.id as journal_entry_id,
    (je.source_id)::uuid as order_id,
    coalesce(nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''), nullif(o.invoice_number,'')) as invoice_number,
    jl.debit,
    jl.credit,
    (jl.debit - jl.credit) as amount,
    coalesce(pu.usage_ids, '{}'::uuid[]) as promotion_usage_ids,
    coalesce(pu.promo_ids, '{}'::uuid[]) as promotion_ids
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  join promo_account pa on pa.id = jl.account_id
  left join public.orders o on o.id = (je.source_id)::uuid
  left join promo_usage pu on pu.order_id = (je.source_id)::uuid
  where je.source_table = 'orders'
    and je.source_event = 'delivered'
    and je.entry_date >= p_start_date
    and je.entry_date <= p_end_date
    and abs(jl.debit - jl.credit) >= coalesce(p_min_amount, 0)
  order by je.entry_date desc, je.id desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_promotion_performance(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_promotion_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(promotion_id uuid, promotion_name text, usage_count bigint, bundles_sold numeric, gross_before_promo numeric, net_after_promo numeric, promotion_expense numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_sales_reports() then
    raise exception 'not allowed';
  end if;

  return query
  select
    p.id as promotion_id,
    p.name as promotion_name,
    count(*) as usage_count,
    public._money_round(sum(coalesce(u.bundle_qty, 0)), 6) as bundles_sold,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'computedOriginalTotal')::numeric, null), 0))) as gross_before_promo,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'finalTotal')::numeric, null), 0))) as net_after_promo,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'promotionExpense')::numeric, null), 0))) as promotion_expense
  from public.promotion_usage u
  join public.promotions p on p.id = u.promotion_id
  left join public.orders o on o.id = u.order_id
  where (p_promotion_id is null or u.promotion_id = p_promotion_id)
    and u.created_at >= p_start_date
    and u.created_at <= p_end_date
    and (o.id is null or o.status = 'delivered')
  group by p.id, p.name
  order by promotion_expense desc, net_after_promo desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_promotion_usage_drilldown(p_promotion_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS TABLE(promotion_usage_id uuid, order_id uuid, invoice_number text, channel text, created_at timestamp with time zone, computed_original_total numeric, final_total numeric, promotion_expense numeric, journal_entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view')) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pu.id as promotion_usage_id,
    pu.order_id,
    coalesce(nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''), nullif(o.invoice_number,'')) as invoice_number,
    pu.channel,
    pu.created_at,
    coalesce(nullif(pu.snapshot->>'computedOriginalTotal','')::numeric, 0) as computed_original_total,
    coalesce(nullif(pu.snapshot->>'finalTotal','')::numeric, 0) as final_total,
    coalesce(nullif(pu.snapshot->>'promotionExpense','')::numeric, 0) as promotion_expense,
    je.id as journal_entry_id
  from public.promotion_usage pu
  left join public.orders o on o.id = pu.order_id
  left join public.journal_entries je
    on je.source_table = 'orders'
   and je.source_id = pu.order_id::text
   and je.source_event = 'delivered'
  where pu.promotion_id = p_promotion_id
    and pu.created_at >= p_start_date
    and pu.created_at <= p_end_date
  order by pu.created_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_promotions_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_result
  from (
    select
      p.id,
      p.name,
      p.start_at,
      p.end_at,
      p.is_active,
      p.discount_mode,
      p.fixed_total,
      p.percent_off,
      p.display_original_total,
      p.max_uses,
      p.stack_policy,
      p.exclusive_with_coupon,
      p.requires_approval,
      p.approval_status,
      p.approval_request_id,
      p.data,
      p.created_by,
      p.created_at,
      p.updated_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pi.id,
          'itemId', pi.item_id,
          'quantity', pi.quantity,
          'sortOrder', pi.sort_order
        ) order by pi.sort_order asc, pi.created_at asc, pi.id asc)
        from public.promotion_items pi
        where pi.promotion_id = p.id
      ), '[]'::jsonb) as items
    from public.promotions p
    order by p.created_at desc, p.id desc
  ) t;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_by_category(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS TABLE(category_name text, total_sales numeric, quantity_sold numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.data,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  ),
  filtered_orders as (
    select *
    from effective_orders eo
    where (eo.status = 'delivered' or eo.paid_at is not null)
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
      jsonb_array_elements(
        case
          when p_invoice_only then
            case
              when jsonb_typeof(fo.data->'invoiceSnapshot'->'items') = 'array' then fo.data->'invoiceSnapshot'->'items'
              else '[]'::jsonb
            end
          else
            case
              when jsonb_typeof(fo.data->'invoiceSnapshot'->'items') = 'array' then fo.data->'invoiceSnapshot'->'items'
              when jsonb_typeof(fo.data->'items') = 'array' then fo.data->'items'
              else '[]'::jsonb
            end
        end
      ) as item
    from filtered_orders fo
  ),
  lines as (
    select
      coalesce(
        nullif(item->>'category',''),
        nullif(item->>'categoryId',''),
        'Uncategorized'
      ) as category_key,
      nullif(item->>'categoryName','') as category_name_raw,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'weight')::numeric, 0) as weight,
      coalesce(item->>'unitType', item->>'unit', 'piece') as unit_type,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      item->'selectedAddons' as addons
    from expanded_items
  ),
  computed_lines as (
    select
      l.category_key,
      l.category_name_raw,
      (
        case
          when l.unit_type in ('kg', 'gram') and l.weight > 0
            then (l.weight * greatest(l.quantity, 1))
          else greatest(l.quantity, 0)
        end
      ) as qty_sold,
      (
        (
          (
            case
              when l.unit_type = 'gram'
                   and l.price_per_unit > 0
                   and l.weight > 0 then (l.price_per_unit / 1000.0) * l.weight
              when l.unit_type in ('kg', 'gram')
                   and l.weight > 0 then l.price * l.weight
              else l.price
            end
            +
            coalesce((
              select sum(
                coalesce((addon_value->'addon'->>'price')::numeric, 0) *
                coalesce((addon_value->>'quantity')::numeric, 0)
              )
              from jsonb_each(l.addons) as a(key, addon_value)
            ), 0)
          )
          *
          case
            when l.unit_type in ('kg', 'gram') and l.weight > 0
              then greatest(l.quantity, 1)
            else greatest(l.quantity, 0)
          end
        )
      ) as sales_amount
    from lines l
  ),
  labeled as (
    select
      coalesce(
        nullif(cl.category_name_raw, ''),
        nullif(ic.data->'name'->>'ar', ''),
        nullif(ic.data->'name'->>'en', ''),
        case when cl.category_key = 'Uncategorized' then 'غير مصنف' else cl.category_key end
      ) as category_name,
      cl.qty_sold,
      cl.sales_amount
    from computed_lines cl
    left join public.item_categories ic on ic.key = cl.category_key
  )
  select
    l.category_name,
    coalesce(sum(l.sales_amount), 0) as total_sales,
    coalesce(sum(l.qty_sold), 0) as quantity_sold
  from labeled l
  group by l.category_name
  order by 2 desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_report_orders(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, status text, date_by timestamp with time zone, total numeric, payment_method text, order_source text, customer_name text, invoice_number text, invoice_issued_at timestamp with time zone, delivery_zone_id uuid, delivery_zone_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with effective_orders as (
    select
      o.id,
      o.status::text as status,
      nullif(o.data->>'deliveredAt', '')::timestamptz as delivered_at,
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz as invoice_issued_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(nullif(o.data->>'paymentMethod',''), 'unknown') as payment_method,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
      coalesce(nullif(o.data->>'customerName',''), '') as customer_name,
      coalesce(
        nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''),
        nullif(o.data->>'invoiceNumber','')
      ) as invoice_number,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    eo.id,
    eo.status,
    eo.date_by,
    eo.total,
    eo.payment_method,
    eo.order_source,
    eo.customer_name,
    eo.invoice_number,
    eo.invoice_issued_at,
    eo.zone_effective as delivery_zone_id,
    coalesce(dz.name, '') as delivery_zone_name
  from effective_orders eo
  left join public.delivery_zones dz on dz.id = eo.zone_effective
  where eo.status = 'delivered'
    and (not p_invoice_only or eo.invoice_issued_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
    and (
      p_search is null
      or nullif(trim(p_search),'') is null
      or right(eo.id::text, 6) ilike '%' || trim(p_search) || '%'
      or coalesce(eo.invoice_number,'') ilike '%' || trim(p_search) || '%'
      or coalesce(eo.customer_name,'') ilike '%' || trim(p_search) || '%'
      or coalesce(eo.payment_method,'') ilike '%' || trim(p_search) || '%'
      or coalesce(dz.name,'') ilike '%' || trim(p_search) || '%'
    )
  order by eo.date_by desc
  limit greatest(1, least(p_limit, 20000))
  offset greatest(0, p_offset);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_report_summary(p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_zone_id uuid DEFAULT NULL::uuid, p_invoice_only boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_collected numeric := 0;
  v_total_tax numeric := 0;
  v_total_delivery numeric := 0;
  v_total_discounts numeric := 0;
  v_gross_subtotal numeric := 0;
  v_total_orders integer := 0;
  v_cancelled_orders integer := 0;
  v_delivered_orders integer := 0;
  v_total_returns numeric := 0;
  v_total_cogs numeric := 0;
  v_total_returns_cogs numeric := 0;
  v_total_wastage numeric := 0;
  v_total_expenses numeric := 0;
  v_total_delivery_cost numeric := 0;
  v_out_for_delivery integer := 0;
  v_in_store integer := 0;
  v_online integer := 0;
  v_tax_refunds numeric := 0;
  v_result json;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) as tax_amount,
      coalesce(nullif((o.data->>'deliveryFee')::numeric, null), 0) as delivery_fee,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as discount_amount,
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as subtotal,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    coalesce(sum(eo.total), 0),
    coalesce(sum(eo.tax_amount), 0),
    coalesce(sum(eo.delivery_fee), 0),
    coalesce(sum(eo.discount_amount), 0),
    coalesce(sum(eo.subtotal), 0),
    count(*),
    count(*) filter (where eo.status = 'delivered')
  into
    v_total_collected,
    v_total_tax,
    v_total_delivery,
    v_total_discounts,
    v_gross_subtotal,
    v_total_orders,
    v_delivered_orders
  from effective_orders eo
  where (
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.id,
      o.status,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with returns_base as (
    select
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as order_subtotal,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as order_discount,
      greatest(
        coalesce(nullif((o.data->>'subtotal')::numeric, null), 0)
        - coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0),
        0
      ) as order_net_subtotal,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) as order_tax,
      coalesce(sum(coalesce(nullif((i->>'quantity')::numeric, null), 0) * coalesce(nullif((i->>'unitPrice')::numeric, null), 0)), 0) as return_subtotal,
      coalesce(sum(sr.total_refund_amount), 0) as total_refund_amount
    from public.sales_returns sr
    join public.orders o on o.id::text = sr.order_id::text
    cross join lateral jsonb_array_elements(coalesce(sr.items, '[]'::jsonb)) i
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
    group by o.id, o.data
  )
  select
    coalesce(sum(total_refund_amount), 0),
    coalesce(sum(
      case
        when order_net_subtotal > 0 and order_tax > 0
          then least(order_tax, (return_subtotal / order_net_subtotal) * order_tax)
        else 0
      end
    ), 0)
  into v_total_returns, v_tax_refunds
  from returns_base;

  v_total_tax := greatest(v_total_tax - v_tax_refunds, 0);

  with effective_orders as (
    select
      o.id,
      o.status,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select coalesce(sum(oic.total_cost), 0)
  into v_total_cogs
  from public.order_item_cogs oic
  join effective_orders eo on oic.order_id = eo.id
  where (
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(im.total_cost), 0)
  into v_total_returns_cogs
  from public.inventory_movements im
  where im.reference_table = 'sales_returns'
    and im.movement_type = 'return_in'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id::text = (im.data->>'orderId') and coalesce(
          o.delivery_zone_id,
          case
            when nullif(o.data->>'deliveryZoneId','') is not null
                 and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (o.data->>'deliveryZoneId')::uuid
            else null
          end
        ) = p_zone_id
      )
    );

  v_total_cogs := greatest(v_total_cogs - v_total_returns_cogs, 0);

  if p_zone_id is null then
    select coalesce(sum(quantity * cost_at_time), 0)
    into v_total_wastage
    from public.stock_wastage
    where created_at >= p_start_date and created_at <= p_end_date;

    select coalesce(sum(amount), 0)
    into v_total_expenses
    from public.expenses
    where date >= p_start_date::date and date <= p_end_date::date;
  else
    v_total_wastage := 0;
    v_total_expenses := 0;
  end if;

  if to_regclass('public.delivery_costs') is not null then
    select coalesce(sum(dc.cost_amount), 0)
    into v_total_delivery_cost
    from public.delivery_costs dc
    where dc.occurred_at >= p_start_date
      and dc.occurred_at <= p_end_date
      and (
        p_zone_id is null or exists (
          select 1 from public.orders o
          where o.id = dc.order_id and coalesce(
            o.delivery_zone_id,
            case
              when nullif(o.data->>'deliveryZoneId','') is not null
                   and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (o.data->>'deliveryZoneId')::uuid
              else null
            end
          ) = p_zone_id
        )
      );
  else
    v_total_delivery_cost := 0;
  end if;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      o.delivery_zone_id
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select
    coalesce(count(*) filter (where status = 'out_for_delivery'), 0),
    coalesce(count(*) filter (where status = 'delivered' and order_source = 'in_store'), 0),
    coalesce(count(*) filter (where status = 'delivered' and order_source <> 'in_store'), 0)
  into v_out_for_delivery, v_in_store, v_online
  from effective_orders eo
  where eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  v_result := json_build_object(
    'total_collected', v_total_collected,
    'gross_subtotal', v_gross_subtotal,
    'returns', v_total_returns,
    'discounts', v_total_discounts,
    'tax', v_total_tax,
    'delivery_fees', v_total_delivery,
    'delivery_cost', v_total_delivery_cost,
    'cogs', v_total_cogs,
    'wastage', v_total_wastage,
    'expenses', v_total_expenses,
    'total_orders', v_total_orders,
    'delivered_orders', v_delivered_orders,
    'cancelled_orders', v_cancelled_orders,
    'out_for_delivery_count', v_out_for_delivery,
    'in_store_count', v_in_store,
    'online_count', v_online
  );

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_admin_users_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if auth.uid() = old.auth_user_id and not public.is_owner() then
    if new.role is distinct from old.role then
      raise exception 'ليس لديك صلاحية لتغيير الدور.';
    end if;
    if new.permissions is distinct from old.permissions then
      raise exception 'ليس لديك صلاحية لتغيير الصلاحيات.';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'ليس لديك صلاحية لتغيير حالة الحساب.';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_admin_permission(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_perms text[];
begin
  select au.role, au.permissions
  into v_role, v_perms
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_role is null then
    return false;
  end if;

  if v_role in ('owner', 'manager') then
    return true;
  end if;

  if v_perms is not null and p = any(v_perms) then
    return true;
  end if;

  if v_role = 'cashier' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid',
      'orders.createInStore',
      'cashShifts.open',
      'cashShifts.viewOwn',
      'cashShifts.closeSelf',
      'cashShifts.cashIn',
      'cashShifts.cashOut'
    ]);
  end if;

  if v_role = 'delivery' then
    return p = any(array[
      'profile.view',
      'orders.view',
      'orders.updateStatus.delivery'
    ]);
  end if;

  if v_role = 'employee' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid'
    ]);
  end if;

  if v_role = 'accountant' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'reports.view',
      'expenses.manage',
      'accounting.view',
      'accounting.manage',
      'accounting.periods.close'
    ]);
  end if;

  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.haversine_distance_meters(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select 2 * 6371000.0 * asin(
    sqrt(
      power(sin(radians((lat2 - lat1) / 2.0)), 2)
      + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians((lng2 - lng1) / 2.0)), 2)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.income_statement(p_start date, p_end date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(income numeric, expenses numeric, net_profit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with tb as (
    select *
    from public.trial_balance(p_start, p_end, p_cost_center_id)
  )
  select
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income,
    coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as net_profit
  from tb;
$function$
;

CREATE OR REPLACE FUNCTION public.income_statement_series(p_start date, p_end date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(period date, income numeric, expenses numeric, net_profit numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with series as (
    select date_trunc('month', gs)::date as period
    from generate_series(
      coalesce(p_start, current_date),
      coalesce(p_end, current_date),
      interval '1 month'
    ) gs
  ),
  joined as (
    select
      s.period,
      coa.account_type,
      jl.debit,
      jl.credit
    from series s
    left join public.journal_entries je
      on je.entry_date::date >= s.period
     and je.entry_date::date < (s.period + interval '1 month')::date
    left join public.journal_lines jl
      on jl.journal_entry_id = je.id
    left join public.chart_of_accounts coa
      on coa.id = jl.account_id
    where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    j.period,
    coalesce(sum(case when j.account_type = 'income' then (j.credit - j.debit) else 0 end), 0) as income,
    coalesce(sum(case when j.account_type = 'expense' then (j.debit - j.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when j.account_type = 'income' then (j.credit - j.debit) else 0 end), 0)
      - coalesce(sum(case when j.account_type = 'expense' then (j.debit - j.credit) else 0 end), 0) as net_profit
  from joined j
  group by j.period
  order by j.period;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_batch_vs_stock_invariant()
 RETURNS TABLE(item_id text, warehouse_id uuid, batch_qty numeric, stock_qty numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with batch_totals as (
    select
      b.item_id::text as item_id,
      b.warehouse_id,
      sum(
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )
      ) as batch_qty
    from public.batches b
    where b.warehouse_id is not null
    group by 1,2
  ),
  stock_totals as (
    select
      sm.item_id::text as item_id,
      sm.warehouse_id,
      sum(coalesce(sm.available_quantity,0)) as stock_qty
    from public.stock_management sm
    where sm.warehouse_id is not null
    group by 1,2
  )
  select
    coalesce(bt.item_id, st.item_id) as item_id,
    coalesce(bt.warehouse_id, st.warehouse_id) as warehouse_id,
    coalesce(bt.batch_qty,0) as batch_qty,
    coalesce(st.stock_qty,0) as stock_qty
  from batch_totals bt
  full join stock_totals st
    on st.item_id = bt.item_id
   and st.warehouse_id = bt.warehouse_id
  where abs(coalesce(bt.batch_qty,0) - coalesce(st.stock_qty,0)) > 0.0001;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_expired_batches_with_remaining()
 RETURNS TABLE(batch_id uuid, item_id text, warehouse_id uuid, expiry_date date, remaining_qty numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    b.id as batch_id,
    b.item_id,
    b.warehouse_id,
    b.expiry_date,
    greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining_qty
  from public.batches b
  where b.expiry_date is not null
    and b.expiry_date < current_date
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_sale_out_from_expired_batches()
 RETURNS TABLE(movement_id uuid, item_id text, batch_id uuid, movement_created_at date, batch_expiry_date date, warehouse_id uuid, reference_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'inventory_movements'
      and c.column_name = 'warehouse_id'
  ) then
    return query
    select
      im.id as movement_id,
      im.item_id,
      im.batch_id,
      im.created_at::date as movement_created_at,
      b.expiry_date as batch_expiry_date,
      im.warehouse_id,
      im.reference_id
    from public.inventory_movements im
    join public.batches b on b.id = im.batch_id
    where im.movement_type = 'sale_out'
      and b.expiry_date is not null
      and b.expiry_date < im.created_at::date;
  else
    return query
    select
      im.id as movement_id,
      im.item_id,
      im.batch_id,
      im.created_at::date as movement_created_at,
      b.expiry_date as batch_expiry_date,
      null::uuid as warehouse_id,
      im.reference_id
    from public.inventory_movements im
    join public.batches b on b.id = im.batch_id
    where im.movement_type = 'sale_out'
      and b.expiry_date is not null
      and b.expiry_date < im.created_at::date;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_transfer_global_qty_invariant()
 RETURNS TABLE(item_id text, total_qty numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    sm.item_id::text,
    sum(sm.available_quantity) as total_qty
  from public.stock_management sm
  group by sm.item_id
  having sum(sm.available_quantity) < 0;
$function$
;

CREATE OR REPLACE FUNCTION public.is_active_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND is_active = true
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_in_closed_period(p_ts timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.accounting_periods ap
    where ap.status = 'closed'
      and (p_ts::date) between ap.start_date and ap.end_date
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_maintenance_on()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_on boolean;
BEGIN
  SELECT data INTO v FROM public.app_settings WHERE id = 'app';
  IF v IS NULL THEN
    SELECT data INTO v FROM public.app_settings WHERE id = 'general_settings';
  END IF;
  v_on := COALESCE((v->'settings'->>'maintenanceEnabled')::boolean, false);
  RETURN v_on;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_owner_or_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner','manager')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner', 'manager', 'employee', 'cashier', 'delivery')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.issue_invoice_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_invoice boolean;
  v_invoice text;
  v_issued_at timestamptz;
  v_snapshot jsonb;
  v_subtotal numeric;
  v_discount numeric;
  v_delivery_fee numeric;
  v_total numeric;
  v_tax numeric;
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    v_has_invoice := (NEW.data ? 'invoiceIssuedAt') AND (NEW.data ? 'invoiceNumber');
    IF NOT coalesce(v_has_invoice, false) THEN
      v_invoice := public.generate_invoice_number();
      v_issued_at := coalesce(
        nullif(NEW.data->>'paidAt', '')::timestamptz,
        nullif(NEW.data->>'deliveredAt', '')::timestamptz,
        now()
      );

      v_subtotal := coalesce(nullif((NEW.data->>'subtotal')::numeric, null), 0);
      v_discount := coalesce(nullif((NEW.data->>'discountAmount')::numeric, null), 0);
      v_delivery_fee := coalesce(nullif((NEW.data->>'deliveryFee')::numeric, null), 0);
      v_tax := coalesce(nullif((NEW.data->>'taxAmount')::numeric, null), 0);
      v_total := coalesce(nullif((NEW.data->>'total')::numeric, null), v_subtotal - v_discount + v_delivery_fee + v_tax);

      v_snapshot := jsonb_build_object(
        'issuedAt', to_jsonb(v_issued_at),
        'invoiceNumber', to_jsonb(v_invoice),
        'createdAt', to_jsonb(coalesce(nullif(NEW.data->>'createdAt',''), NEW.created_at::text)),
        'orderSource', to_jsonb(coalesce(nullif(NEW.data->>'orderSource',''), 'online')),
        'items', coalesce(NEW.data->'items', '[]'::jsonb),
        'subtotal', to_jsonb(v_subtotal),
        'deliveryFee', to_jsonb(v_delivery_fee),
        'discountAmount', to_jsonb(v_discount),
        'total', to_jsonb(v_total),
        'paymentMethod', to_jsonb(coalesce(nullif(NEW.data->>'paymentMethod',''), 'cash')),
        'customerName', to_jsonb(coalesce(NEW.data->>'customerName', '')),
        'phoneNumber', to_jsonb(coalesce(NEW.data->>'phoneNumber', '')),
        'address', to_jsonb(coalesce(NEW.data->>'address', '')),
        'deliveryZoneId', CASE WHEN NEW.data ? 'deliveryZoneId' THEN to_jsonb(NEW.data->>'deliveryZoneId') ELSE NULL END
      );

      NEW.data := jsonb_set(NEW.data, '{invoiceNumber}', to_jsonb(v_invoice), true);
      NEW.data := jsonb_set(NEW.data, '{invoiceIssuedAt}', to_jsonb(v_issued_at), true);
      NEW.data := jsonb_set(NEW.data, '{invoiceSnapshot}', v_snapshot, true);
      IF NOT (NEW.data ? 'invoicePrintCount') THEN
        NEW.data := jsonb_set(NEW.data, '{invoicePrintCount}', '0'::jsonb, true);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.list_active_accounts()
 RETURNS TABLE(id uuid, code text, name text, account_type text, normal_balance text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;
  return query
  select id, code, name, account_type, normal_balance
  from public.chart_of_accounts
  where is_active = true
  order by code asc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_approval_requests(p_status text DEFAULT 'pending'::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, target_table text, target_id text, request_type text, status text, requested_by uuid, approved_by uuid, approved_at timestamp with time zone, rejected_by uuid, rejected_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_limit int;
begin
  perform public._require_staff('list_approval_requests');
  v_status := nullif(trim(coalesce(p_status, '')), '');
  v_limit := coalesce(p_limit, 200);
  if v_limit < 1 then v_limit := 1; end if;
  if v_limit > 500 then v_limit := 500; end if;

  if v_status is null or v_status = 'all' then
    return query
    select
      ar.id,
      ar.target_table,
      ar.target_id,
      ar.request_type,
      ar.status,
      ar.requested_by,
      ar.approved_by,
      ar.approved_at,
      ar.rejected_by,
      ar.rejected_at,
      ar.created_at
    from public.approval_requests ar
    order by ar.created_at desc nulls last
    limit v_limit;
  end if;

  if v_status not in ('pending','approved','rejected') then
    raise exception 'invalid status';
  end if;

  return query
  select
    ar.id,
    ar.target_table,
    ar.target_id,
    ar.request_type,
    ar.status,
    ar.requested_by,
    ar.approved_by,
    ar.approved_at,
    ar.rejected_by,
    ar.rejected_at,
    ar.created_at
  from public.approval_requests ar
  where ar.status = v_status
  order by ar.created_at desc nulls last
  limit v_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_approval_steps(p_request_ids uuid[])
 RETURNS TABLE(id uuid, request_id uuid, step_no integer, approver_role text, status text, action_by uuid, action_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._require_staff('list_approval_steps');
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;
  return query
  select
    s.id,
    s.request_id,
    s.step_no,
    s.approver_role,
    s.status,
    s.action_by,
    s.action_at
  from public.approval_steps s
  where s.request_id = any(p_request_ids)
  order by s.request_id asc, s.step_no asc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_currencies_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'insert',
      'currencies',
      concat('Inserted currency ', new.code),
      auth.uid(),
      now(),
      jsonb_build_object('table','currencies','code',new.code,'is_base',new.is_base,'is_high_inflation',new.is_high_inflation)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'update',
      'currencies',
      concat('Updated currency ', new.code),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table','currencies',
        'code',new.code,
        'old_is_base',old.is_base,
        'new_is_base',new.is_base,
        'old_is_high_inflation',old.is_high_inflation,
        'new_is_high_inflation',new.is_high_inflation
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'currencies',
      concat('Deleted currency ', old.code),
      auth.uid(),
      now(),
      jsonb_build_object('table','currencies','code',old.code,'is_base',old.is_base,'is_high_inflation',old.is_high_inflation)
    );
    return old;
  end if;
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_fx_rates_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'insert',
      'fx_rates',
      concat('Inserted FX rate ', new.currency_code, ' ', new.rate_type, ' ', new.rate_date::text, ' = ', new.rate::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', new.id,
        'currency_code', new.currency_code,
        'rate_type', new.rate_type,
        'rate_date', new.rate_date,
        'rate', new.rate
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'update',
      'fx_rates',
      concat('Updated FX rate ', new.currency_code, ' ', new.rate_type, ' ', new.rate_date::text, ' = ', new.rate::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', new.id,
        'currency_code', new.currency_code,
        'rate_type', new.rate_type,
        'rate_date', new.rate_date,
        'old_rate', old.rate,
        'new_rate', new.rate
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'fx_rates',
      concat('Deleted FX rate ', old.currency_code, ' ', old.rate_type, ' ', old.rate_date::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', old.id,
        'currency_code', old.currency_code,
        'rate_type', old.rate_type,
        'rate_date', old.rate_date,
        'rate', old.rate
      )
    );
    return old;
  end if;
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_menu_item_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old_price numeric;
  v_new_price numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_item_name_ar text;
begin
  if tg_op = 'UPDATE' then
    v_old_price := coalesce(nullif(old.data->>'price', '')::numeric, 0);
    v_new_price := coalesce(nullif(new.data->>'price', '')::numeric, 0);
    v_old_cost := coalesce(nullif(old.data->>'costPrice', '')::numeric, 0);
    v_new_cost := coalesce(nullif(new.data->>'costPrice', '')::numeric, 0);
    v_item_name_ar := coalesce(new.data->'name'->>'ar', new.data->'name'->>'en', new.id);

    if v_old_price is distinct from v_new_price then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'price_change',
        'menu_items',
        concat('Price changed for item "', v_item_name_ar, '" (', new.id, ') from ', coalesce(v_old_price::text, 'NULL'), ' to ', coalesce(v_new_price::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_price', v_old_price,
          'new_price', v_new_price,
          'change_amount', coalesce(v_new_price, 0) - coalesce(v_old_price, 0)
        )
      );
    end if;

    if v_old_cost is distinct from v_new_cost then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'cost_change',
        'menu_items',
        concat('Cost price changed for item "', v_item_name_ar, '" (', new.id, ') from ', coalesce(v_old_cost::text, 'NULL'), ' to ', coalesce(v_new_cost::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_cost', v_old_cost,
          'new_cost', v_new_cost
        )
      );
    end if;

    if (old.data->>'status') is distinct from (new.data->>'status') then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'status_change',
        'menu_items',
        concat('Status changed for item "', v_item_name_ar, '" (', new.id, ') from ', old.data->>'status', ' to ', new.data->>'status'),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_status', old.data->>'status',
          'new_status', new.data->>'status'
        )
      );
    end if;
  elsif tg_op = 'DELETE' then
    v_item_name_ar := coalesce(old.data->'name'->>'ar', old.data->'name'->>'en', old.id);
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'menu_items',
      concat('Deleted item "', v_item_name_ar, '" (', old.id, ')'),
      auth.uid(),
      now(),
      jsonb_build_object(
        'item_id', old.id,
        'item_name', old.data->'name',
        'item_data', old.data
      )
    );
  end if;

  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_delivery_assignment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old text;
  v_new text;
  v_link text;
BEGIN
  v_old := COALESCE(NULLIF(OLD.data->>'assignedDeliveryUserId',''), NULL);
  v_new := COALESCE(NULLIF(NEW.data->>'assignedDeliveryUserId',''), NULL);
  v_link := '/admin/orders';
  
  IF v_old IS DISTINCT FROM v_new THEN
    IF v_new IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_new::uuid, 'تم إسناد طلب إليك 🛵', 'طلب #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
    END IF;
    IF v_old IS NOT NULL AND v_new IS NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_old::uuid, 'أُلغي إسناد أحد الطلبات', 'طلب #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_order_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_link text;
  r_admin record;
BEGIN
  v_link := '/order/' || NEW.id::text;
  
  IF NEW.customer_auth_user_id IS NOT NULL THEN
    v_title := 'تم استلام طلبك ✅';
    v_message := 'جارٍ معالجة طلبك رقم #' || substring(NEW.id::text, 1, 6);
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.customer_auth_user_id, v_title, v_message, 'order_update', v_link);
  END IF;
  
  FOR r_admin IN
    SELECT au.auth_user_id
    FROM public.admin_users au
    WHERE au.is_active = true
      AND au.role IN ('owner','manager')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (r_admin.auth_user_id, 'طلب جديد وصل 🧾', 'طلب جديد #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_link text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_link := '/order/' || NEW.id::text;
    CASE NEW.status
      WHEN 'preparing' THEN
        v_title := 'طلبك قيد التحضير 🍳';
        v_message := 'بدأنا في تجهيز طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'out_for_delivery' THEN
        v_title := 'طلبك في الطريق 🛵';
        v_message := 'خرج المندوب لتوصيل طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'delivered' THEN
        v_title := 'تم التوصيل 🎉';
        v_message := 'نتمنى لك تجربة ممتعة! تم توصيل الطلب #' || substring(NEW.id::text, 1, 6);
      WHEN 'cancelled' THEN
        v_title := 'تم إلغاء الطلب ❌';
        v_message := 'عذراً، تم إلغاء طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'scheduled' THEN
        v_title := 'تم جدولة الطلب 📅';
        v_message := 'تم تأكيد جدولة طلبك رقم #' || substring(NEW.id::text, 1, 6);
      ELSE
        RETURN NEW;
    END CASE;
    IF NEW.customer_auth_user_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.customer_auth_user_id, v_title, v_message, 'order_update', v_link);
      EXCEPTION WHEN others THEN
        PERFORM NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.open_cash_shift_for_cashier(p_cashier_id uuid, p_start_amount numeric)
 RETURNS public.cash_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_role text;
  v_exists int;
  v_shift public.cash_shifts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null or v_actor_role not in ('owner','manager') then
    raise exception 'not allowed';
  end if;

  if p_cashier_id is null then
    raise exception 'p_cashier_id is required';
  end if;

  if coalesce(p_start_amount, 0) < 0 then
    raise exception 'invalid start amount';
  end if;

  select count(1)
  into v_exists
  from public.cash_shifts s
  where s.cashier_id = p_cashier_id
    and coalesce(s.status, 'open') = 'open';

  if v_exists > 0 then
    raise exception 'cashier already has an open shift';
  end if;

  insert into public.cash_shifts(cashier_id, opened_at, start_amount, status)
  values (p_cashier_id, now(), coalesce(p_start_amount, 0), 'open')
  returning * into v_shift;

  return v_shift;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.order_delivered_at(p_order_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select min(oe.created_at)
      from public.order_events oe
      where oe.order_id = p_order_id
        and oe.to_status = 'delivered'
    ),
    (
      select case when o.status = 'delivered' then o.updated_at else null end
      from public.orders o
      where o.id = p_order_id
      limit 1
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.orders_validate_delivery_zone_radius()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source text;
  v_zone_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_zone_lat double precision;
  v_zone_lng double precision;
  v_radius double precision;
  v_is_active boolean;
  v_dist double precision;
begin
  v_source := coalesce(nullif(new.data->>'orderSource',''), '');
  if v_source = 'in_store' then
    return new;
  end if;

  v_zone_id := new.delivery_zone_id;
  if v_zone_id is null
     and nullif(new.data->>'deliveryZoneId','') is not null
     and (new.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_zone_id := (new.data->>'deliveryZoneId')::uuid;
  end if;

  if v_zone_id is null then
    raise exception 'يرجى اختيار منطقة توصيل صحيحة.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(new.data->'location') <> 'object' then
    raise exception 'عذرًا، لا يمكن إرسال الطلب بدون تحديد موقعك على الخريطة.' using errcode = 'P0001';
  end if;

  v_lat := nullif(new.data->'location'->>'lat','')::double precision;
  v_lng := nullif(new.data->'location'->>'lng','')::double precision;
  if v_lat is null or v_lng is null then
    raise exception 'عذرًا، تعذر قراءة إحداثيات موقعك.' using errcode = 'P0001';
  end if;

  select
    nullif(dz.data->'coordinates'->>'lat','')::double precision,
    nullif(dz.data->'coordinates'->>'lng','')::double precision,
    nullif(dz.data->'coordinates'->>'radius','')::double precision,
    dz.is_active
  into v_zone_lat, v_zone_lng, v_radius, v_is_active
  from public.delivery_zones dz
  where dz.id = v_zone_id;

  if not found then
    raise exception 'منطقة التوصيل غير موجودة.' using errcode = 'P0001';
  end if;

  if not coalesce(v_is_active, false) then
    raise exception 'منطقة التوصيل غير مفعلة.' using errcode = 'P0001';
  end if;

  if v_zone_lat is null or v_zone_lng is null or v_radius is null or v_radius <= 0 then
    raise exception 'تعذر التحقق من نطاق منطقة التوصيل. يرجى التواصل مع الإدارة.' using errcode = 'P0001';
  end if;

  v_dist := public.haversine_distance_meters(v_lat, v_lng, v_zone_lat, v_zone_lng);
  if v_dist > v_radius then
    raise exception 'عذرًا، موقعك خارج نطاق منطقة التوصيل.' using errcode = 'P0001';
  end if;

  new.delivery_zone_id := v_zone_id;
  new.data := jsonb_set(new.data, '{deliveryZoneId}', to_jsonb(v_zone_id::text), true);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pgrst_ddl_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
  loop
    if cmd.command_tag in (
      'CREATE FUNCTION','ALTER FUNCTION','DROP FUNCTION',
      'CREATE TABLE','ALTER TABLE','DROP TABLE',
      'CREATE VIEW','ALTER VIEW','DROP VIEW',
      'COMMENT'
    ) and cmd.schema_name is distinct from 'pg_temp' then
      perform pg_notify('pgrst','reload schema');
    end if;
  end loop;
end; $function$
;

CREATE OR REPLACE FUNCTION public.pgrst_drop_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_dropped_objects()
  loop
    if obj.object_type in ('function','table','view','type','trigger','schema','rule')
       and obj.is_temporary is false then
      perform pg_notify('pgrst','reload schema');
    end if;
  end loop;
end; $function$
;

CREATE OR REPLACE FUNCTION public.post_cash_shift_close(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift record;
  v_entry_id uuid;
  v_cash uuid;
  v_over_short uuid;
  v_diff numeric;
begin
  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;
  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id;
  if not found then
    raise exception 'cash shift not found';
  end if;
  if coalesce(v_shift.status, 'open') <> 'closed' then
    return;
  end if;
  v_cash := public.get_account_id_by_code('1010');
  v_over_short := public.get_account_id_by_code('6110');
  v_diff := coalesce(v_shift.difference, coalesce(v_shift.end_amount, 0) - coalesce(v_shift.expected_amount, 0));
  if abs(v_diff) <= 1e-9 then
    return;
  end if;
  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(v_shift.closed_at, now()),
    concat('Cash shift close ', v_shift.id::text),
    'cash_shifts',
    v_shift.id::text,
    'closed',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;
  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;
  if v_diff < 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_over_short, abs(v_diff), 0, 'Cash shortage'),
      (v_entry_id, v_cash, 0, abs(v_diff), 'Adjust cash to counted');
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cash, v_diff, 0, 'Adjust cash to counted'),
      (v_entry_id, v_over_short, 0, v_diff, 'Cash overage');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_inventory_movement(p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mv record;
  v_entry_id uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ap uuid;
  v_shrinkage uuid;
  v_gain uuid;
  v_vat_input uuid;
  v_supplier_tax_total numeric;
begin
  perform public._require_staff('accounting.post');
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select *
  into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;
  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  if v_mv.movement_type in ('transfer_out', 'transfer_in') then
    return;
  end if;

  if exists (
    select 1 from public.journal_entries je
    where je.source_table = 'inventory_movements'
      and je.source_id = v_mv.id::text
      and je.source_event = v_mv.movement_type
  ) then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');
  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  returning id into v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    if v_supplier_tax_total > 0 and v_vat_input is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost - v_supplier_tax_total, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT input'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    end if;
  elsif v_mv.movement_type in ('sale_out','expired_out','wastage_out') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, case when v_mv.movement_type = 'sale_out' then 'COGS' else concat(v_mv.movement_type, ' (COGS)') end),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Adjustment out'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Adjustment in'),
      (v_entry_id, v_gain, 0, v_mv.total_cost, 'Inventory gain');
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_invoice_issued(p_order_id uuid, p_issued_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_data jsonb;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_total numeric := 0;
  v_subtotal numeric := 0;
  v_discount_amount numeric := 0;
  v_delivery_fee numeric := 0;
  v_tax_amount numeric := 0;
  v_deposits_paid numeric := 0;
  v_ar_amount numeric := 0;
  v_accounts jsonb;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_is_cod := public._is_cod_delivery_order(v_data, v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;
  select s.data->'accounting_accounts' into v_accounts from public.app_settings s where s.id = 'singleton';
  v_ar := public.get_account_id_by_code(coalesce(v_accounts->>'ar','1200'));
  v_deposits := public.get_account_id_by_code(coalesce(v_accounts->>'deposits','2050'));
  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));
  v_total := coalesce(nullif((v_data->'invoiceSnapshot'->>'total')::numeric, null), coalesce(nullif((v_data->>'total')::numeric, null), 0));
  if v_total <= 0 then
    return;
  end if;
  v_subtotal := coalesce(nullif((v_data->'invoiceSnapshot'->>'subtotal')::numeric, null), coalesce(nullif((v_data->>'subtotal')::numeric, null), 0));
  v_discount_amount := coalesce(nullif((v_data->'invoiceSnapshot'->>'discountAmount')::numeric, null), coalesce(nullif((v_data->>'discountAmount')::numeric, null), 0));
  v_delivery_fee := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), coalesce(nullif((v_data->>'deliveryFee')::numeric, null), 0));
  v_tax_amount := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), coalesce(nullif((v_data->>'taxAmount')::numeric, null), 0));
  v_tax_amount := least(greatest(0, v_tax_amount), v_total);
  v_delivery_fee := least(greatest(0, v_delivery_fee), v_total - v_tax_amount);
  select coalesce(sum(p.amount), 0)
  into v_deposits_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in'
    and p.occurred_at < coalesce(p_issued_at, now());
  v_deposits_paid := least(v_total, greatest(0, coalesce(v_deposits_paid, 0)));
  v_ar_amount := greatest(0, v_total - v_deposits_paid);
  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      coalesce(p_issued_at, now()),
      concat('Order invoiced ', p_order_id::text),
      'orders',
      p_order_id::text,
      'invoiced',
      auth.uid()
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'posting already exists for this source; create a reversal instead';
  end;
  if v_deposits_paid > 0 and v_deposits is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, v_deposits_paid, 0, 'Apply customer deposit');
  end if;
  if v_ar_amount > 0 and v_ar is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, v_ar_amount, 0, 'Accounts receivable');
  end if;
  if (v_total - v_delivery_fee - v_tax_amount) > 0 and v_sales is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales, 0, (v_total - v_delivery_fee - v_tax_amount), 'Sales revenue');
  end if;
  if v_delivery_fee > 0 and v_delivery_income is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_delivery_income, 0, v_delivery_fee, 'Delivery income');
  end if;
  if v_tax_amount > 0 and v_vat_payable is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, 0, v_tax_amount, 'VAT payable');
  end if;
  perform public.check_journal_entry_balance(v_entry_id);
  perform public.sync_ar_on_invoice(p_order_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_order_delivery(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_entry_id uuid;
  v_total numeric;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  v_promo_expense_account uuid;
  v_delivered_at timestamptz;
  v_deposits_paid numeric;
  v_ar_amount numeric;
  v_discount_amount numeric;
  v_delivery_fee numeric;
  v_tax_amount numeric;
  v_items_revenue numeric;
  v_sales_amount numeric;
  v_promo_expense_total numeric := 0;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_total := coalesce(nullif((v_order.data->>'total')::numeric, null), 0);
  if v_total <= 0 then
    return;
  end if;

  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales := public.get_account_id_by_code('4010');
  v_delivery_income := public.get_account_id_by_code('4020');
  v_vat_payable := public.get_account_id_by_code('2020');
  v_promo_expense_account := coalesce(public.get_account_id_by_code('6150'), public.get_account_id_by_code('6100'));

  v_discount_amount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), 0);
  v_delivery_fee := coalesce(nullif((v_order.data->>'deliveryFee')::numeric, null), 0);
  v_tax_amount := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), 0);

  v_tax_amount := least(greatest(0, v_tax_amount), v_total);
  v_delivery_fee := least(greatest(0, v_delivery_fee), v_total - v_tax_amount);
  v_items_revenue := greatest(0, v_total - v_delivery_fee - v_tax_amount);

  select coalesce(sum(coalesce(nullif((pl->>'promotionExpense')::numeric, null), 0)), 0)
  into v_promo_expense_total
  from jsonb_array_elements(coalesce(v_order.data->'promotionLines', '[]'::jsonb)) as pl;

  v_promo_expense_total := public._money_round(coalesce(v_promo_expense_total, 0));
  v_sales_amount := public._money_round(v_items_revenue + v_promo_expense_total);

  v_delivered_at := public.order_delivered_at(p_order_id);
  if v_delivered_at is null then
    v_delivered_at := coalesce(v_order.updated_at, now());
  end if;

  select coalesce(sum(p.amount), 0)
  into v_deposits_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in'
    and p.occurred_at < v_delivered_at;

  v_deposits_paid := least(v_total, greatest(0, coalesce(v_deposits_paid, 0)));
  v_ar_amount := greatest(0, v_total - v_deposits_paid);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(v_order.updated_at, now()),
    concat('Order delivered ', v_order.id::text),
    'orders',
    v_order.id::text,
    'delivered',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_deposits_paid > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, public._money_round(v_deposits_paid), 0, 'Apply customer deposit');
  end if;

  if v_ar_amount > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, public._money_round(v_ar_amount), 0, 'Accounts receivable');
  end if;

  if v_sales_amount > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales, 0, public._money_round(v_sales_amount), 'Sales revenue');
  end if;

  if v_promo_expense_total > 0 and v_promo_expense_account is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_promo_expense_account, public._money_round(v_promo_expense_total), 0, 'Promotion expense');
  end if;

  if v_delivery_fee > 0 and v_delivery_income is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_delivery_income, 0, public._money_round(v_delivery_fee), 'Delivery income');
  end if;

  if v_tax_amount > 0 and v_vat_payable is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, 0, public._money_round(v_tax_amount), 'VAT payable');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_payment(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pay record;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_ap uuid;
  v_expenses uuid;
  v_gain_real uuid;
  v_loss_real uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_order_id uuid;
  v_open_ar numeric;
  v_settle_ar numeric;
  v_po_id uuid;
  v_po_base_total numeric;
  v_po_paid_base numeric;
  v_settle_ap numeric;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;

  select * into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if not found then
    raise exception 'payment not found';
  end if;

  select je.id into v_entry_id
  from public.journal_entries je
  where je.source_table = 'payments'
    and je.source_id = v_pay.id::text
  limit 1;

  if v_entry_id is not null then
    return;
  end if;

  v_amount_base := coalesce(v_pay.base_amount, v_pay.amount, 0);
  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_gain_real := public.get_account_id_by_code('6200');
  v_loss_real := public.get_account_id_by_code('6201');

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('in:orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    select coalesce(open_balance, 0) into v_open_ar
    from public.ar_open_items
    where invoice_id = v_order_id and status = 'open'
    limit 1;

    if v_open_ar is null then
      select coalesce(o.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount, p.amount))
        from public.payments p
        where p.reference_table = 'orders'
          and p.direction = 'in'
          and p.reference_id = v_order_id::text
          and p.id <> v_pay.id
      ), 0)
      into v_open_ar
      from public.orders o
      where o.id = v_order_id;
    end if;

    v_settle_ar := greatest(0, v_open_ar);

    if v_amount_base >= v_settle_ar then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable');
      if (v_amount_base - v_settle_ar) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_gain_real, 0, v_amount_base - v_settle_ar, 'FX Gain realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable'),
        (v_entry_id, v_loss_real, v_settle_ar - v_amount_base, 0, 'FX Loss realized');
    end if;

    update public.ar_open_items
    set status = 'closed',
        open_balance = 0,
        closed_at = v_pay.occurred_at
    where invoice_id = v_order_id and status = 'open';
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_po_id := nullif(v_pay.reference_id, '')::uuid;
    if v_po_id is null then
      raise exception 'invalid purchase order reference_id';
    end if;

    select coalesce(base_total, 0) into v_po_base_total
    from public.purchase_orders
    where id = v_po_id;

    select coalesce(sum(coalesce(p.base_amount, p.amount)), 0)
    into v_po_paid_base
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.direction = 'out'
      and p.reference_id = v_po_id::text
      and p.id <> v_pay.id;

    v_settle_ap := greatest(0, v_po_base_total - coalesce(v_po_paid_base, 0));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    if v_amount_base >= v_settle_ap then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
      if (v_amount_base - v_settle_ap) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_loss_real, v_amount_base - v_settle_ap, 0, 'FX Loss realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid'),
        (v_entry_id, v_gain_real, 0, v_settle_ap - v_amount_base, 'FX Gain realized');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_expenses, v_amount_base, 0, 'Operating expense'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    return;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_production_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id uuid;
  v_inventory uuid;
  v_shrinkage uuid;
  v_gain uuid;
  v_inputs_total numeric;
  v_outputs_total numeric;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  v_inventory := public.get_account_id_by_code('1410');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');

  select coalesce(sum(total_cost), 0) into v_inputs_total
  from public.production_order_inputs where order_id = p_order_id;
  select coalesce(sum(total_cost), 0) into v_outputs_total
  from public.production_order_outputs where order_id = p_order_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce((select occurred_at from public.production_orders where id = p_order_id), now()),
    concat('Production order ', p_order_id::text),
    'production_orders',
    p_order_id::text,
    'posted',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_outputs_total > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_inventory, v_outputs_total, 0, 'Production outputs to inventory');
  end if;
  if v_inputs_total > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_inventory, 0, v_inputs_total, 'Production inputs from inventory');
  end if;

  if abs(v_outputs_total - v_inputs_total) > 1e-6 then
    if v_outputs_total > v_inputs_total then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_gain, 0, v_outputs_total - v_inputs_total, 'Production variance (gain)');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_shrinkage, v_inputs_total - v_outputs_total, 0, 'Production variance (loss)');
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_supplier_invoice_variance(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv record;
  v_variance numeric;
  v_entry_id uuid;
  v_ap uuid;
  v_ppv uuid;
begin
  select * into v_inv from public.supplier_invoices where id = p_invoice_id;
  if not found then
    raise exception 'supplier invoice not found';
  end if;
  if v_inv.status <> 'matched' then
    raise exception 'invoice is not matched';
  end if;

  select coalesce(sum(line_total), 0) into v_variance
  from public.supplier_invoice_lines
  where invoice_id = p_invoice_id;

  v_variance := v_variance - coalesce(v_inv.total_amount, 0);
  if abs(v_variance) < 0.0001 then
    update public.supplier_invoices set status = 'posted' where id = p_invoice_id;
    return;
  end if;

  v_ap := public.get_account_id_by_code('2010');
  v_ppv := public.get_account_id_by_code('5030');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    now(),
    concat('Supplier invoice variance ', v_inv.invoice_number),
    'supplier_invoices',
    v_inv.id::text,
    'variance',
    auth.uid()
  )
  returning id into v_entry_id;

  if v_variance > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ppv, v_variance, 0, 'Price variance'),
      (v_entry_id, v_ap, 0, v_variance, 'Increase payable');
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, abs(v_variance), 0, 'Decrease payable'),
      (v_entry_id, v_ppv, 0, abs(v_variance), 'Price variance');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
  update public.supplier_invoices set status = 'posted' where id = p_invoice_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Modification of audit logs is strictly prohibited.';
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_multiple_owners()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role = 'owner' then
    if exists (
      select 1
      from public.admin_users au
      where au.auth_user_id <> coalesce(new.auth_user_id, old.auth_user_id)
        and au.role = 'owner'
    ) then
      raise exception 'only_one_owner';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.process_expired_items()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  processed_count integer := 0;
  v_wh_id uuid;
  v_has_warehouse boolean := false;
  v_batch record;
  v_stock record;
  v_wastage_qty numeric;
  v_effective_wastage_qty numeric;
  v_wastage_id uuid;
  v_reserved_batches jsonb;
  v_reserved_entry jsonb;
  v_reserved_list jsonb;
  v_order_id uuid;
  v_order_id_text text;
  v_unit_cost numeric;
  v_movement_id uuid;
  v_new_available numeric;
  v_new_reserved numeric;
  v_expired_batch_key text;
  v_reserved_cancel_total numeric;
  v_order_reserved_qty numeric;
  v_need numeric;
  v_candidate record;
  v_candidate_key text;
  v_candidate_entry jsonb;
  v_candidate_list jsonb;
  v_candidate_reserved numeric;
  v_free numeric;
  v_alloc numeric;
  v_list_new jsonb;
  v_key text;
  v_tmp_list jsonb;
  v_tmp_list_new jsonb;
  v_total_available numeric;
  v_qr numeric;
  v_qc numeric;
  v_batch_expiry date;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  v_has_warehouse := (to_regclass('public.warehouses') is not null);

  for v_batch in
    select *
    from public.v_food_batch_balances v
    where v.expiry_date is not null
      and v.expiry_date < current_date
      and greatest(coalesce(v.remaining_qty, 0), 0) > 0
    order by v.expiry_date asc, v.batch_id asc
  loop
    processed_count := processed_count + 1;
    v_wh_id := v_batch.warehouse_id;

    if v_has_warehouse then
      if v_wh_id is null then
        select w.id
        into v_wh_id
        from public.warehouses w
        order by w.code asc
        limit 1;
      end if;
      if v_wh_id is null then
        raise exception 'No warehouse found for expiry processing';
      end if;
    end if;

    v_wastage_qty := greatest(coalesce(v_batch.remaining_qty, 0), 0);
    if v_wastage_qty <= 0 then
      continue;
    end if;

    if v_has_warehouse and v_wh_id is not null then
      select *
      into v_stock
      from public.stock_management sm
      where sm.item_id::text = v_batch.item_id
        and sm.warehouse_id = v_wh_id
      for update;
    else
      select *
      into v_stock
      from public.stock_management sm
      where sm.item_id::text = v_batch.item_id
      for update;
    end if;

    if not found then
      continue;
    end if;

    v_effective_wastage_qty := v_wastage_qty;

    select
      b.quantity_received,
      b.quantity_consumed,
      b.unit_cost,
      b.expiry_date
    into v_qr, v_qc, v_unit_cost, v_batch_expiry
    from public.batches b
    where b.id = v_batch.batch_id
      and b.item_id::text = v_batch.item_id::text
      and (not v_has_warehouse or b.warehouse_id is not distinct from v_wh_id)
    for update;

    if not found then
      continue;
    end if;

    v_unit_cost := coalesce(v_unit_cost, v_stock.avg_cost, 0);

    v_reserved_batches := coalesce(v_stock.data->'reservedBatches', '{}'::jsonb);
    v_expired_batch_key := v_batch.batch_id::text;

    v_reserved_entry := v_reserved_batches->v_expired_batch_key;
    v_reserved_list :=
      case
        when v_reserved_entry is null then '[]'::jsonb
        when jsonb_typeof(v_reserved_entry) = 'array' then v_reserved_entry
        when jsonb_typeof(v_reserved_entry) = 'object' then jsonb_build_array(v_reserved_entry)
        else '[]'::jsonb
      end;

    v_reserved_cancel_total := 0;

    for v_order_id_text, v_order_reserved_qty in
      select
        (e->>'orderId') as order_id_text,
        coalesce(nullif(e->>'qty','')::numeric, 0) as qty
      from jsonb_array_elements(v_reserved_list) e
    loop
      if v_order_id_text is null or v_order_id_text = '' then
        continue;
      end if;
      begin
        v_order_id := v_order_id_text::uuid;
      exception when others then
        v_order_id := null;
      end;
      if v_order_id is null then
        continue;
      end if;

      v_need := greatest(coalesce(v_order_reserved_qty, 0), 0);
      if v_need <= 0 then
        continue;
      end if;

      v_reserved_cancel_total := v_reserved_cancel_total + v_need;

      for v_candidate in
        select
          b2.batch_id,
          b2.expiry_date,
          b2.remaining_qty
        from public.v_food_batch_balances b2
        where b2.item_id = v_batch.item_id
          and b2.warehouse_id is not distinct from v_wh_id
          and b2.batch_id <> v_batch.batch_id
          and (b2.expiry_date is null or b2.expiry_date >= current_date)
          and greatest(coalesce(b2.remaining_qty, 0), 0) > 0
        order by b2.expiry_date asc nulls last, b2.batch_id asc
      loop
        exit when v_need <= 0;

        v_candidate_key := v_candidate.batch_id::text;
        v_candidate_entry := v_reserved_batches->v_candidate_key;
        v_candidate_list :=
          case
            when v_candidate_entry is null then '[]'::jsonb
            when jsonb_typeof(v_candidate_entry) = 'array' then v_candidate_entry
            when jsonb_typeof(v_candidate_entry) = 'object' then jsonb_build_array(v_candidate_entry)
            else '[]'::jsonb
          end;

        select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
        into v_candidate_reserved
        from jsonb_array_elements(v_candidate_list) as x;

        v_free := greatest(coalesce(v_candidate.remaining_qty, 0) - coalesce(v_candidate_reserved, 0), 0);
        if v_free <= 0 then
          continue;
        end if;

        v_alloc := least(v_need, v_free);
        if v_alloc <= 0 then
          continue;
        end if;

        with elems as (
          select value, ordinality
          from jsonb_array_elements(v_candidate_list) with ordinality
        )
        select
          case
            when exists (select 1 from elems where (value->>'orderId') = v_order_id::text) then (
              select coalesce(
                jsonb_agg(
                  case
                    when (value->>'orderId') = v_order_id::text then
                      jsonb_set(
                        value,
                        '{qty}',
                        to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) + v_alloc),
                        true
                      )
                    else value
                  end
                  order by ordinality
                ),
                '[]'::jsonb
              )
            )
            else (
              (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) from elems)
              || jsonb_build_array(jsonb_build_object('orderId', v_order_id, 'batchId', v_candidate_key, 'qty', v_alloc))
            )
          end
        into v_list_new;

        v_reserved_batches := jsonb_set(v_reserved_batches, array[v_candidate_key], v_list_new, true);

        v_need := v_need - v_alloc;
      end loop;
    end loop;

    v_tmp_list := '[]'::jsonb;
    for v_key in
      select key
      from jsonb_each(v_reserved_batches)
    loop
      if v_key <> v_expired_batch_key then
        continue;
      end if;
      v_tmp_list := coalesce(v_reserved_batches->v_key, '[]'::jsonb);
    end loop;

    v_reserved_batches := v_reserved_batches - v_expired_batch_key;

    v_new_available := greatest(0, coalesce(v_stock.available_quantity, 0) - v_effective_wastage_qty);
    v_new_reserved := greatest(0, coalesce(v_stock.reserved_quantity, 0) - least(greatest(coalesce(v_reserved_cancel_total, 0), 0), greatest(coalesce(v_stock.reserved_quantity, 0), 0)));

    update public.batches
    set quantity_consumed = quantity_consumed + v_effective_wastage_qty
    where id = v_batch.batch_id
    returning quantity_received, quantity_consumed into v_qr, v_qc;

    if coalesce(v_qc, 0) > coalesce(v_qr, 0) then
      raise exception 'Over-consumption detected for expired batch %', v_batch.batch_id;
    end if;

    update public.stock_management
    set available_quantity = v_new_available,
        reserved_quantity = v_new_reserved,
        last_updated = now(),
        updated_at = now(),
        data = jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(data, '{}'::jsonb), '{availableQuantity}', to_jsonb(v_new_available), true),
            '{reservedQuantity}',
            to_jsonb(v_new_reserved),
            true
          ),
          '{reservedBatches}',
          v_reserved_batches,
          true
        )
    where item_id::text = v_batch.item_id
      and (not v_has_warehouse or warehouse_id = v_wh_id);

    insert into public.stock_wastage (
      item_id,
      quantity,
      unit_type,
      cost_at_time,
      reason,
      notes,
      reported_by,
      created_at,
      batch_id,
      warehouse_id
    )
    select
      mi.id,
      v_effective_wastage_qty,
      mi.unit_type,
      v_unit_cost,
      'auto_expired',
      'Auto-processed batch expiry detection',
      auth.uid(),
      now(),
      v_batch.batch_id,
      v_wh_id
    from public.menu_items mi
    where mi.id = v_batch.item_id
    returning id into v_wastage_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_batch.item_id,
      'expired_out',
      v_effective_wastage_qty,
      v_unit_cost,
      v_effective_wastage_qty * v_unit_cost,
      'batches',
      v_batch.batch_id::text,
      now(),
      auth.uid(),
      jsonb_build_object(
        'reason', 'expiry',
        'expiryDate', coalesce(v_batch_expiry, v_batch.expiry_date),
        'warehouseId', v_wh_id,
        'batchId', v_batch.batch_id
      ),
      v_batch.batch_id,
      v_wh_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  return json_build_object('success', true, 'processed_count', processed_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.process_sales_return(p_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ret record;
  v_order record;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_sales_returns uuid;
  v_vat_payable uuid;
  v_order_subtotal numeric;
  v_order_discount numeric;
  v_order_net_subtotal numeric;
  v_order_tax numeric;
  v_return_subtotal numeric;
  v_tax_refund numeric;
  v_total_refund numeric;
  v_refund_method text;
  v_shift_id uuid;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_needed numeric;
  v_sale record;
  v_already numeric;
  v_free numeric;
  v_alloc numeric;
  v_ret_batch_id uuid;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
  v_ar_reduction numeric := 0;
begin
  perform public._require_staff('process_sales_return');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;

  if p_return_id is null then
    raise exception 'p_return_id is required';
  end if;

  select *
  into v_ret
  from public.sales_returns r
  where r.id = p_return_id
  for update;
  if not found then
    raise exception 'sales return not found';
  end if;
  if v_ret.status = 'completed' then
    return;
  end if;
  if v_ret.status = 'cancelled' then
    raise exception 'sales return is cancelled';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = v_ret.order_id;
  if not found then
    raise exception 'order not found';
  end if;
  if coalesce(v_order.status,'') <> 'delivered' then
    raise exception 'sales return requires delivered order';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales_returns := public.get_account_id_by_code('4026');
  v_vat_payable := public.get_account_id_by_code('2020');

  v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric, null), coalesce(v_order.subtotal, 0), 0);
  v_order_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), coalesce(v_order.discount, 0), 0);
  v_order_net_subtotal := greatest(0, v_order_subtotal - v_order_discount);
  v_order_tax := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), coalesce(v_order.tax_amount, 0), 0);

  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount, null), 0);
  if v_return_subtotal <= 0 then
    raise exception 'invalid return amount';
  end if;

  v_tax_refund := 0;
  if v_order_net_subtotal > 0 and v_order_tax > 0 then
    v_tax_refund := least(v_order_tax, (v_return_subtotal / v_order_net_subtotal) * v_order_tax);
  end if;
  v_total_refund := public._money_round(v_return_subtotal + v_tax_refund);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
  values (
    coalesce(v_ret.return_date, now()),
    concat('Sales return ', v_ret.id::text),
    'sales_returns',
    v_ret.id::text,
    'processed',
    auth.uid(),
    'posted'
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry_id, v_sales_returns, public._money_round(v_return_subtotal), 0, 'Sales return');

  if v_tax_refund > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, public._money_round(v_tax_refund), 0, 'Reverse VAT payable');
  end if;

  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
  if v_refund_method in ('bank', 'bank_transfer') then
    v_refund_method := 'kuraimi';
  elsif v_refund_method in ('card', 'online') then
    v_refund_method := 'network';
  end if;

  if v_refund_method = 'cash' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
  elsif v_refund_method in ('network','kuraimi') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_bank, 0, v_total_refund, 'Bank refund');
  elsif v_refund_method = 'ar' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, 0, v_total_refund, 'Reduce accounts receivable');
    v_ar_reduction := v_total_refund;
  elsif v_refund_method = 'store_credit' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, 0, v_total_refund, 'Increase customer deposit');
  else
    v_refund_method := 'cash';
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_ret.items, '[]'::jsonb))
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', '')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    v_needed := v_qty;

    for v_sale in
      select im.id, im.item_id, im.quantity, im.unit_cost, im.total_cost, im.batch_id, im.warehouse_id, im.occurred_at
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = v_ret.order_id::text
        and im.movement_type = 'sale_out'
        and im.item_id::text = v_item_id::text
      order by im.occurred_at asc, im.id asc
    loop
      exit when v_needed <= 0;

      select coalesce(sum(imr.quantity), 0)
      into v_already
      from public.inventory_movements imr
      where imr.reference_table = 'sales_returns'
        and imr.movement_type = 'return_in'
        and (imr.data->>'orderId') = v_ret.order_id::text
        and (imr.data->>'sourceMovementId') = v_sale.id::text;

      v_free := greatest(coalesce(v_sale.quantity, 0) - coalesce(v_already, 0), 0);
      if v_free <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_free);
      if v_alloc <= 0 then
        continue;
      end if;

      select b.expiry_date, b.production_date, b.unit_cost
      into v_source_batch
      from public.batches b
      where b.id = v_sale.batch_id;

      v_wh := v_sale.warehouse_id;
      if v_wh is null then
        v_wh := coalesce(v_order.warehouse_id, public._resolve_default_admin_warehouse_id());
      end if;
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;

      v_ret_batch_id := gen_random_uuid();
      insert into public.batches(
        id,
        item_id,
        receipt_item_id,
        receipt_id,
        warehouse_id,
        batch_code,
        production_date,
        expiry_date,
        quantity_received,
        quantity_consumed,
        unit_cost,
        qc_status,
        data
      )
      values (
        v_ret_batch_id,
        v_item_id::text,
        null,
        null,
        v_wh,
        null,
        v_source_batch.production_date,
        v_source_batch.expiry_date,
        v_alloc,
        0,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'pending',
        jsonb_build_object(
          'source', 'sales_returns',
          'salesReturnId', v_ret.id::text,
          'orderId', v_ret.order_id::text,
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        )
      );

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item_id::text,
        'return_in',
        v_alloc,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        v_alloc * coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'sales_returns',
        v_ret.id::text,
        coalesce(v_ret.return_date, now()),
        auth.uid(),
        jsonb_build_object(
          'orderId', v_ret.order_id::text,
          'warehouseId', v_wh::text,
          'salesReturnId', v_ret.id::text,
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        ),
        v_ret_batch_id,
        v_wh
      )
      returning id into v_movement_id;

      perform public.post_inventory_movement(v_movement_id);
      perform public.recompute_stock_for_item(v_item_id::text, v_wh);

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 1e-9 then
      raise exception 'return exceeds sold quantity for item %', v_item_id;
    end if;
  end loop;

  update public.sales_returns
  set status = 'completed',
      updated_at = now()
  where id = p_return_id;

  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
  if v_refund_method = 'cash' and v_shift_id is null then
    raise exception 'cash refund requires an open cash shift';
  end if;

  if v_refund_method in ('cash','network','kuraimi') then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'out',
      v_refund_method,
      v_total_refund,
      coalesce(v_order.data->>'currency', v_order.currency, 'YER'),
      'sales_returns',
      v_ret.id::text,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id::text),
      v_shift_id
    );
  end if;

  perform public._apply_ar_open_item_credit(v_ret.order_id, v_ar_reduction);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_items_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_purchase_order_totals(old.purchase_order_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.purchase_order_id is distinct from old.purchase_order_id) then
    perform public.recalc_purchase_order_totals(old.purchase_order_id);
    perform public.recalc_purchase_order_totals(new.purchase_order_id);
    return new;
  end if;

  perform public.recalc_purchase_order_totals(new.purchase_order_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_items_set_total_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_orders_recalc_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  perform public.recalc_purchase_order_totals(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_receipt_items_set_total_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_return_items_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_old_order_id uuid;
  v_new_order_id uuid;
begin
  if tg_op = 'DELETE' then
    select pr.purchase_order_id into v_old_order_id
    from public.purchase_returns pr
    where pr.id = old.return_id;
    perform public.recalc_purchase_order_totals(v_old_order_id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    select pr.purchase_order_id into v_old_order_id
    from public.purchase_returns pr
    where pr.id = old.return_id;
    select pr.purchase_order_id into v_new_order_id
    from public.purchase_returns pr
    where pr.id = new.return_id;
    if v_old_order_id is distinct from v_new_order_id then
      perform public.recalc_purchase_order_totals(v_old_order_id);
    end if;
    perform public.recalc_purchase_order_totals(v_new_order_id);
    return new;
  end if;

  select pr.purchase_order_id into v_new_order_id
  from public.purchase_returns pr
  where pr.id = new.return_id;
  perform public.recalc_purchase_order_totals(v_new_order_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_return_items_set_total_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.qc_inspect_batch(p_batch_id uuid, p_result text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
begin
  perform public._require_staff('qc_inspect_batch');
  if not public.has_admin_permission('qc.inspect') then
    raise exception 'ليس لديك صلاحية فحص QC';
  end if;
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;
  if coalesce(p_result,'') not in ('pass','fail') then
    raise exception 'result must be pass or fail';
  end if;

  select b.id, b.item_id, b.warehouse_id, coalesce(b.qc_status,'') as qc_status
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception 'batch not found';
  end if;

  if v_batch.qc_status not in ('pending','quarantined') then
    raise exception 'batch qc_status must be pending';
  end if;

  insert into public.qc_checks(batch_id, check_type, result, checked_by, checked_at, notes)
  values (p_batch_id, 'inspection', p_result, auth.uid(), now(), nullif(p_notes,''));

  update public.batches
  set qc_status = 'inspected',
      updated_at = now()
  where id = p_batch_id;

  perform public.recompute_stock_for_item(v_batch.item_id, v_batch.warehouse_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.qc_release_batch(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
  v_last_result text;
begin
  perform public._require_staff('qc_release_batch');
  if not public.has_admin_permission('qc.release') then
    raise exception 'ليس لديك صلاحية إفراج QC';
  end if;
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;

  select b.id, b.item_id, b.warehouse_id, coalesce(b.qc_status,'') as qc_status
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception 'batch not found';
  end if;

  if v_batch.qc_status <> 'inspected' then
    raise exception 'batch qc_status must be inspected';
  end if;

  select qc.result
  into v_last_result
  from public.qc_checks qc
  where qc.batch_id = p_batch_id
    and qc.check_type = 'inspection'
  order by qc.checked_at desc
  limit 1;

  if coalesce(v_last_result,'') <> 'pass' then
    raise exception 'QC inspection must pass before release';
  end if;

  update public.batches
  set qc_status = 'released',
      updated_at = now()
  where id = p_batch_id;

  perform public.recompute_stock_for_item(v_batch.item_id, v_batch.warehouse_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rebuild_order_line_items(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  delete from public.order_line_items where order_id = p_order_id;
  for v_item in select value from jsonb_array_elements(coalesce(v_order.items, v_order.data->'items', '[]'::jsonb))
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'price')::numeric, 0);
    insert into public.order_line_items(order_id, item_id, quantity, unit_price, total, data)
    values (p_order_id, v_item_id, v_qty, v_price, v_qty * v_price, v_item);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_purchase_order_totals(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_items_total numeric;
  v_returns_total numeric;
  v_net_total numeric;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(sum(coalesce(pi.total_cost, coalesce(pi.quantity, 0) * coalesce(pi.unit_cost, 0))), 0)
  into v_items_total
  from public.purchase_items pi
  where pi.purchase_order_id = p_order_id;

  select coalesce(sum(coalesce(pri.total_cost, coalesce(pri.quantity, 0) * coalesce(pri.unit_cost, 0))), 0)
  into v_returns_total
  from public.purchase_returns pr
  join public.purchase_return_items pri on pri.return_id = pr.id
  where pr.purchase_order_id = p_order_id;

  v_net_total := greatest(0, coalesce(v_items_total, 0) - coalesce(v_returns_total, 0));

  update public.purchase_orders po
  set
    total_amount = v_net_total,
    items_count = coalesce((
      select count(*)
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    ), 0),
    paid_amount = least(coalesce(po.paid_amount, 0), v_net_total),
    updated_at = now()
  where po.id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_stock_for_item(p_item_id text, p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_food boolean := false;
begin
  perform public._require_staff('recompute_stock_for_item');

  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'item_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  select (coalesce(mi.category,'') = 'food')
  into v_is_food
  from public.menu_items mi
  where mi.id::text = p_item_id::text;

  insert into public.stock_management(item_id, warehouse_id, available_quantity, qc_hold_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
  select p_item_id, p_warehouse_id, 0, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
  from public.menu_items mi
  where mi.id::text = p_item_id::text
  on conflict (item_id, warehouse_id) do nothing;

  update public.stock_management sm
  set
    reserved_quantity = coalesce((
      select sum(r.quantity)
      from public.order_item_reservations r
      where r.item_id::text = p_item_id::text
        and r.warehouse_id = p_warehouse_id
    ), 0),
    available_quantity = coalesce((
      select sum(
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )
      )
      from public.batches b
      where b.item_id::text = p_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status,'active') = 'active'
        and coalesce(b.qc_status,'') = 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
    ), 0),
    qc_hold_quantity = coalesce((
      select sum(
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )
      )
      from public.batches b
      where b.item_id::text = p_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status,'active') = 'active'
        and coalesce(b.qc_status,'') <> 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
    ), 0),
    last_updated = now(),
    updated_at = now()
  where sm.item_id::text = p_item_id::text
    and sm.warehouse_id = p_warehouse_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_expense_accrual(p_expense_id uuid, p_amount numeric, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_entry_id uuid;
  v_expenses uuid;
  v_ap uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_expense_id is null then
    raise exception 'p_expense_id is required';
  end if;

  select coalesce(p_amount, 0)
  into v_amount;
  if v_amount <= 0 then
    select coalesce(e.amount, 0)
    into v_amount
    from public.expenses e
    where e.id = p_expense_id;
  end if;
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_expenses := public.get_account_id_by_code('6100');
  v_ap := public.get_account_id_by_code('2010');
  if v_expenses is null or v_ap is null then
    raise exception 'required accounts not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_occurred_at, now()),
    concat('Expense accrual ', p_expense_id::text),
    'expenses',
    p_expense_id::text,
    'accrual',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_expenses, v_amount, 0, 'Accrued expense'),
    (v_entry_id, v_ap, 0, v_amount, 'Accounts payable');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_expense_payment(p_expense_id uuid, p_amount numeric, p_method text, p_occurred_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_shift_id uuid;
begin
  if not public.can_manage_expenses() then
    raise exception 'not allowed';
  end if;

  if p_expense_id is null then
    raise exception 'p_expense_id is required';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    select coalesce(e.amount, 0)
    into v_amount
    from public.expenses e
    where e.id = p_expense_id;
  end if;

  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method = 'card' then
    v_method := 'network';
  elsif v_method = 'bank' then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'expenses',
    p_expense_id::text,
    v_occurred_at,
    auth.uid(),
    jsonb_build_object('expenseId', p_expense_id::text),
    v_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_order_payment(p_order_id uuid, p_amount numeric, p_method text, p_occurred_at timestamp with time zone, p_idempotency_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_total numeric;
  v_paid numeric;
  v_idempotency text;
  v_shift_id uuid;
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
    if not public.has_admin_permission('orders.markPaid') then
      raise exception 'not allowed';
    end if;
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select coalesce(nullif((o.data->>'total')::numeric, null), 0)
  into v_total
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in';
  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;
  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  v_occurred_at := coalesce(p_occurred_at, now());
  v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');
  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;
  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;
  if v_idempotency is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_shift_id
    );
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_idempotency,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do update set
      method = excluded.method,
      amount = excluded.amount,
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_purchase_order_payment(p_purchase_order_id uuid, p_amount numeric, p_method text, p_occurred_at timestamp with time zone, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_total numeric;
  v_status text;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_data jsonb;
  v_idempotency_key text;
  v_shift_id uuid;
  v_paid_sum numeric;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  if p_purchase_order_id is null then
    raise exception 'p_purchase_order_id is required';
  end if;

  select coalesce(po.total_amount, 0), po.status
  into v_total, v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot pay cancelled purchase order';
  end if;

  v_total := coalesce(v_total, 0);
  if v_total <= 0 then
    raise exception 'purchase order total is zero';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid_sum
  from public.payments p
  where p.reference_table = 'purchase_orders'
    and p.direction = 'out'
    and p.reference_id = p_purchase_order_id::text;

  if (v_total - coalesce(v_paid_sum, 0)) <= 0.000000001 then
    raise exception 'purchase order already fully paid';
  end if;

  if (coalesce(v_paid_sum, 0) + v_amount) > (v_total + 0.000000001) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_data := jsonb_strip_nulls(jsonb_build_object('purchaseOrderId', p_purchase_order_id::text) || coalesce(p_data, '{}'::jsonb));
  v_idempotency_key := nullif(trim(coalesce(v_data->>'idempotencyKey', '')), '');
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  if v_idempotency_key is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'out',
      v_method,
      v_amount,
      'YER',
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data,
      v_shift_id
    )
    returning id into v_payment_id;
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'out',
      v_method,
      v_amount,
      'YER',
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data,
      v_idempotency_key,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do nothing
    returning id into v_payment_id;

    if v_payment_id is null then
      return;
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_shift_cash_movement(p_shift_id uuid, p_direction text, p_amount numeric, p_reason text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift public.cash_shifts%rowtype;
  v_amount numeric;
  v_dir text;
  v_actor_role text;
  v_payment_id uuid;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null then
    raise exception 'not allowed';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if coalesce(v_shift.status, 'open') <> 'open' then
    raise exception 'cash shift is not open';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  v_dir := lower(nullif(trim(coalesce(p_direction, '')), ''));
  if v_dir not in ('in', 'out') then
    raise exception 'invalid direction';
  end if;

  if auth.uid() = v_shift.cashier_id then
    if v_dir = 'in' and not public.has_admin_permission('cashShifts.cashIn') then
      raise exception 'not allowed';
    end if;
    if v_dir = 'out' and not public.has_admin_permission('cashShifts.cashOut') then
      raise exception 'not allowed';
    end if;
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_dir = 'out' and v_reason is null then
    raise exception 'يرجى إدخال سبب الصرف.';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    v_dir,
    'cash',
    v_amount,
    'YER',
    'cash_shifts',
    p_shift_id::text,
    coalesce(p_occurred_at, now()),
    auth.uid(),
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'reason', v_reason, 'kind', 'cash_movement')),
    p_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    case when v_dir = 'in' then 'cash_shift_cash_in' else 'cash_shift_cash_out' end,
    'cash_shifts',
    case when v_dir = 'in' then 'Cash movement in' else 'Cash movement out' end,
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object('shiftId', p_shift_id::text, 'paymentId', v_payment_id::text, 'amount', v_amount, 'direction', v_dir, 'reason', v_reason)),
    'MEDIUM',
    'SHIFT_CASH_MOVE'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_pos_offline_sale_created(p_offline_id text, p_order_id uuid, p_created_at timestamp with time zone, p_warehouse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'CREATED_OFFLINE', '{}'::jsonb, v_actor, coalesce(p_created_at, now()), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    created_at = least(public.pos_offline_sales.created_at, excluded.created_at),
    updated_at = now();

  return jsonb_build_object('status', 'OK', 'offlineId', p_offline_id, 'orderId', p_order_id::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_approval_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.approval_requests
  set status = 'rejected', rejected_by = auth.uid(), rejected_at = now()
  where id = p_request_id;
  update public.approval_steps
  set status = 'rejected', action_by = auth.uid(), action_at = now()
  where request_id = p_request_id and status = 'pending';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_reserved_stock_for_order(p_items jsonb, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select
    coalesce(
      o.warehouse_id,
      case
        when nullif(o.data->>'warehouseId','') is not null
             and (o.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'warehouseId')::uuid
        else null
      end
    )
  into v_wh
  from public.orders o
  where o.id = p_order_id;

  if v_wh is null then
    begin
      v_wh := public._resolve_default_warehouse_id();
    exception when others then
      v_wh := null;
    end;
  end if;

  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  perform public.release_reserved_stock_for_order(p_items, p_order_id, v_wh);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_reserved_stock_for_order(p_items jsonb, p_order_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_to_release numeric;
  v_row record;
  v_take numeric;
  v_is_food boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'order not found';
  end if;

  if not public.is_staff() then
    if not exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and o.customer_auth_user_id = v_actor
    ) then
      raise exception 'not allowed';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, nullif(v_item->>'qty','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    v_to_release := v_qty;
    for v_row in
      select r.id, r.quantity
      from public.order_item_reservations r
      where r.order_id = p_order_id
        and r.item_id::text = v_item_id::text
        and r.warehouse_id = p_warehouse_id
        and r.quantity > 0
      order by r.created_at asc, r.id asc
    loop
      exit when v_to_release <= 0;
      v_take := least(v_to_release, coalesce(v_row.quantity, 0));
      if v_take <= 0 then
        continue;
      end if;
      if coalesce(v_row.quantity, 0) - v_take <= 0 then
        delete from public.order_item_reservations r
        where r.id = v_row.id;
      else
        update public.order_item_reservations
        set quantity = quantity - v_take,
            updated_at = now()
        where id = v_row.id;
      end if;
      v_to_release := v_to_release - v_take;
    end loop;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(r2.quantity)
          from public.order_item_reservations r2
          where r2.item_id::text = v_item_id::text
            and r2.warehouse_id = p_warehouse_id
        ), 0),
        available_quantity = coalesce((
          select sum(
            greatest(
              coalesce(b.quantity_received,0)
              - coalesce(b.quantity_consumed,0)
              - coalesce(b.quantity_transferred,0),
              0
            )
          )
          from public.batches b
          where b.item_id::text = v_item_id::text
            and b.warehouse_id = p_warehouse_id
            and coalesce(b.status,'active') = 'active'
            and coalesce(b.qc_status,'') = 'released'
            and not exists (
              select 1 from public.batch_recalls br
              where br.batch_id = b.id and br.status = 'active'
            )
            and (
              not coalesce(v_is_food, false)
              or (b.expiry_date is not null and b.expiry_date >= current_date)
            )
        ), 0),
        last_updated = now(),
        updated_at = now()
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = p_warehouse_id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_offline_reconciliation(p_offline_id text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_row record;
  v_req_id uuid;
  v_reason text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  select *
  into v_row
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if not found then
    raise exception 'offline sale not found';
  end if;

  if v_row.state not in ('CONFLICT','FAILED') then
    return jsonb_build_object('status', 'NOT_REQUIRED', 'offlineId', p_offline_id, 'state', v_row.state);
  end if;

  if v_row.reconciliation_status = 'PENDING'
     and v_row.reconciliation_approval_request_id is not null then
    return jsonb_build_object(
      'status', 'PENDING',
      'offlineId', p_offline_id,
      'approvalRequestId', v_row.reconciliation_approval_request_id::text
    );
  end if;

  v_req_id := public.create_approval_request(
    'pos_offline_sales',
    p_offline_id,
    'offline_reconciliation',
    0,
    jsonb_build_object(
      'offlineId', p_offline_id,
      'orderId', v_row.order_id::text,
      'state', v_row.state,
      'lastError', v_row.last_error,
      'reason', v_reason
    )
  );

  update public.pos_offline_sales
  set reconciliation_status = 'PENDING',
      reconciliation_approval_request_id = v_req_id,
      reconciliation_note = v_reason,
      updated_at = now()
  where offline_id = p_offline_id;

  return jsonb_build_object(
    'status', 'PENDING',
    'offlineId', p_offline_id,
    'approvalRequestId', v_req_id::text
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_stock_for_order(p_items jsonb, p_order_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_needed numeric;
  v_is_food boolean;
  v_batch record;
  v_reserved_other numeric;
  v_free numeric;
  v_alloc numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null or p_warehouse_id is null then
    raise exception 'order_id and warehouse_id are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id',''));
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, nullif(v_item->>'qty','')::numeric, 0);
    if v_item_id is null or v_item_id = '' or v_requested <= 0 then
      continue;
    end if;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;

    delete from public.order_item_reservations r
    where r.order_id = p_order_id
      and r.item_id = v_item_id::text
      and r.warehouse_id = p_warehouse_id;

    v_needed := v_requested;

    for v_batch in
      select
        b.id as batch_id,
        b.expiry_date,
        b.unit_cost,
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        ) as remaining_qty
      from public.batches b
      where b.item_id::text = v_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status, 'active') = 'active'
        and coalesce(b.qc_status,'') = 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
      order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
      for update
    loop
      exit when v_needed <= 0;
      if coalesce(v_batch.remaining_qty, 0) <= 0 then
        continue;
      end if;

      select coalesce(sum(r2.quantity), 0)
      into v_reserved_other
      from public.order_item_reservations r2
      where r2.batch_id = v_batch.batch_id
        and r2.warehouse_id = p_warehouse_id
        and r2.order_id <> p_order_id;

      v_free := greatest(coalesce(v_batch.remaining_qty, 0) - coalesce(v_reserved_other, 0), 0);
      if v_free <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_free);
      if v_alloc <= 0 then
        continue;
      end if;

      insert into public.order_item_reservations(order_id, item_id, warehouse_id, batch_id, quantity, created_at, updated_at)
      values (p_order_id, v_item_id::text, p_warehouse_id, v_batch.batch_id, v_alloc, now(), now());

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 0 then
      raise exception 'INSUFFICIENT_FEFO_BATCH_STOCK_FOR_ITEM_%', v_item_id;
    end if;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(r.quantity)
          from public.order_item_reservations r
          where r.item_id = v_item_id::text
            and r.warehouse_id = p_warehouse_id
        ), 0),
        available_quantity = coalesce((
          select sum(
            greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
          )
          from public.batches b
          where b.item_id::text = v_item_id::text
            and b.warehouse_id = p_warehouse_id
            and coalesce(b.status,'active') = 'active'
            and coalesce(b.qc_status,'') = 'released'
            and not exists (
              select 1 from public.batch_recalls br
              where br.batch_id = b.id and br.status = 'active'
            )
            and (
              not coalesce(v_is_food, false)
              or (b.expiry_date is not null and b.expiry_date >= current_date)
            )
        ), 0),
        last_updated = now(),
        updated_at = now()
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = p_warehouse_id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_stock_for_order(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_user_id uuid;
BEGIN
  v_order_id := (p_payload->>'order_id')::uuid;
  v_user_id  := (p_payload->>'user_id')::uuid;

  -- منطق الحجز هنا
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reverse_payment_journal(p_payment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text;
  v_existing_id uuid;
  v_new_entry_id uuid;
begin
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')), '');
  if v_reason is null then
    raise exception 'reason required';
  end if;
  perform public.set_audit_reason(v_reason);
  select id into v_existing_id
  from public.journal_entries
  where source_table = 'payments' and source_id = p_payment_id::text
  order by created_at desc
  limit 1;
  if v_existing_id is null then
    raise exception 'payment journal not found';
  end if;
  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (now(), concat('Void payment ', p_payment_id::text), 'payments', p_payment_id::text, 'void', auth.uid())
  returning id into v_new_entry_id;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select v_new_entry_id, account_id, credit, debit, coalesce(line_memo,'') || ' (reversal)'
  from public.journal_lines
  where journal_entry_id = v_existing_id;
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('payments.void', 'payments', p_payment_id::text, auth.uid(), now(),
          jsonb_build_object('voidOfJournal', v_existing_id::text, 'newEntryId', v_new_entry_id::text),
          'HIGH', v_reason);
  return v_new_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_echo_text(p_text text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(p_text, '');
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_has_function(p_name text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when position('(' in p_name) > 0 then to_regprocedure(p_name) is not null
    else to_regproc(p_name) is not null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_list_public_functions(p_like text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result text[];
begin
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
  into v_result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname ilike p_like;
  return coalesce(v_result, array[]::text[]);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_reload_postgrest_schema()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform pg_notify('pgrst', 'reload schema');
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_expiry_job()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run_id uuid;
begin
  insert into public.job_runs(job_name, started_at, status)
  values ('process_expired_batches', now(), 'running')
  returning id into v_run_id;
  begin
    perform public.process_expired_items();
    update public.job_runs set status = 'success', finished_at = now() where id = v_run_id;
  exception when others then
    update public.job_runs set status = 'failed', finished_at = now(), error = sqlerrm where id = v_run_id;
    raise;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_fx_revaluation(p_period_end date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gain_unreal uuid := public.get_account_id_by_code('6250');
  v_loss_unreal uuid := public.get_account_id_by_code('6251');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_ap uuid := public.get_account_id_by_code('2010');
  v_base text := public.get_base_currency();
  v_base_high boolean := false;
  v_item record;
  v_rate numeric;
  v_revalued numeric;
  v_diff numeric;
  v_reval_entry_id uuid;
  v_rev_entry_id uuid;
  v_source_id uuid;
begin
  if p_period_end is null then
    raise exception 'period end required';
  end if;

  select coalesce(c.is_high_inflation, false)
  into v_base_high
  from public.currencies c
  where upper(c.code) = upper(v_base)
  limit 1;

  for v_item in
    select a.id as open_item_id,
           a.invoice_id as entity_id,
           upper(coalesce(o.currency, v_base)) as currency,
           coalesce(a.open_balance, 0) as original_base,
           coalesce(o.total, 0) as invoice_total_foreign,
           coalesce(o.base_total, coalesce(o.total,0) * coalesce(o.fx_rate,1)) as invoice_total_base
    from public.ar_open_items a
    join public.orders o on o.id = a.invoice_id
    where a.status = 'open'
  loop
    if exists(
      select 1
      from public.fx_revaluation_audit x
      where x.period_end = p_period_end
        and x.entity_type = 'AR'
        and x.entity_id = v_item.entity_id
    ) then
      continue;
    end if;

    if upper(v_item.currency) = upper(v_base) then
      if not v_base_high then
        continue;
      end if;
      v_rate := public.get_fx_rate(v_base, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting rate missing for base currency % at %', v_base, p_period_end;
      end if;
      v_revalued := v_item.original_base * v_rate;
    else
      v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
      end if;
      if coalesce(v_item.invoice_total_base, 0) <= 0 then
        continue;
      end if;
      v_revalued := (v_item.invoice_total_foreign * (v_item.original_base / v_item.invoice_total_base)) * v_rate;
    end if;

    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;

    v_source_id := public.uuid_from_text(concat('AR:', v_item.entity_id::text, ':', p_period_end::text, ':reval'));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AR ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid()
    )
    returning id into v_reval_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_ar, v_diff, 0, 'Increase AR'),
        (v_reval_entry_id, v_gain_unreal, 0, v_diff, 'Unrealized FX Gain');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_loss_unreal, abs(v_diff), 0, 'Unrealized FX Loss'),
        (v_reval_entry_id, v_ar, 0, abs(v_diff), 'Decrease AR');
    end if;

    select je.id into v_rev_entry_id
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = v_reval_entry_id::text
      and je.source_event = 'reversal'
    limit 1;

    if v_rev_entry_id is null then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
      select
        (p_period_end + interval '1 day'),
        concat('Reversal FX Revaluation AR ', v_item.entity_id::text),
        'journal_entries',
        v_reval_entry_id::text,
        'reversal',
        auth.uid(),
        je.document_id,
        je.branch_id,
        je.company_id
      from public.journal_entries je
      where je.id = v_reval_entry_id
      returning id into v_rev_entry_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      select v_rev_entry_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
      from public.journal_lines jl
      where jl.journal_entry_id = v_reval_entry_id;
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AR', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_reval_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;

  for v_item in
    select po.id as entity_id,
           upper(coalesce(po.currency, v_base)) as currency,
           greatest(0, coalesce(po.base_total, 0) - coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)) as original_base,
           coalesce(po.total_amount, 0) - coalesce((select sum(coalesce(p.amount,0)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0) as remaining_foreign
    from public.purchase_orders po
    where coalesce(po.base_total, 0) > coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)
  loop
    if exists(
      select 1
      from public.fx_revaluation_audit x
      where x.period_end = p_period_end
        and x.entity_type = 'AP'
        and x.entity_id = v_item.entity_id
    ) then
      continue;
    end if;

    if upper(v_item.currency) = upper(v_base) then
      if not v_base_high then
        continue;
      end if;
      v_rate := public.get_fx_rate(v_base, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting rate missing for base currency % at %', v_base, p_period_end;
      end if;
      v_revalued := v_item.original_base * v_rate;
    else
      v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
      end if;
      v_revalued := greatest(0, v_item.remaining_foreign) * v_rate;
    end if;

    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;

    v_source_id := public.uuid_from_text(concat('AP:', v_item.entity_id::text, ':', p_period_end::text, ':reval'));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AP ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid()
    )
    returning id into v_reval_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_loss_unreal, v_diff, 0, 'Unrealized FX Loss'),
        (v_reval_entry_id, v_ap, 0, v_diff, 'Increase AP');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_ap, abs(v_diff), 0, 'Decrease AP'),
        (v_reval_entry_id, v_gain_unreal, 0, abs(v_diff), 'Unrealized FX Gain');
    end if;

    select je.id into v_rev_entry_id
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = v_reval_entry_id::text
      and je.source_event = 'reversal'
    limit 1;

    if v_rev_entry_id is null then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
      select
        (p_period_end + interval '1 day'),
        concat('Reversal FX Revaluation AP ', v_item.entity_id::text),
        'journal_entries',
        v_reval_entry_id::text,
        'reversal',
        auth.uid(),
        je.document_id,
        je.branch_id,
        je.company_id
      from public.journal_entries je
      where je.id = v_reval_entry_id
      returning id into v_rev_entry_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      select v_rev_entry_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
      from public.journal_lines jl
      where jl.journal_entry_id = v_reval_entry_id;
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AP', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_reval_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_audit_reason(p_reason text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('app.audit_reason', p_reason, true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_base_currency(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_ar_on_invoice(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;

  select je.id
  into v_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event in ('invoiced','delivered')
  order by
    case when je.source_event = 'invoiced' then 0 else 1 end asc,
    je.entry_date desc
  limit 1;
  if not found then
    return;
  end if;

  select public.get_account_id_by_code('1200') into v_ar_id;
  if v_ar_id is null then
    raise exception 'AR account not found';
  end if;
  select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
  into v_ar_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry_id
    and jl.account_id = v_ar_id;
  if v_ar_amount is null or v_ar_amount <= 0 then
    return;
  end if;

  if exists (
    select 1 from public.ar_open_items a
    where a.invoice_id = p_order_id
      and a.status = 'open'
  ) then
    update public.ar_open_items
    set original_amount = v_ar_amount,
        open_balance = greatest(open_balance, v_ar_amount)
    where invoice_id = p_order_id
      and status = 'open';
  else
    insert into public.ar_open_items(invoice_id, order_id, journal_entry_id, original_amount, open_balance, status)
    values (p_order_id, p_order_id, v_entry_id, v_ar_amount, v_ar_amount, 'open');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_expense_cost_center()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_entry_id uuid;
begin
  -- Find the journal entry associated with this expense
  select id into v_entry_id
  from public.journal_entries
  where source_table = 'expenses' and source_id = new.id::text;

  if v_entry_id is not null then
    -- Update ALL lines (debit and credit) to match the expense cost center
    -- This ensures the cash side is also tagged, allowing for balanced reporting per cost center for expenses
    update public.journal_lines
    set cost_center_id = new.cost_center_id
    where journal_entry_id = v_entry_id;
  end if;
  
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_offline_pos_sale(p_offline_id text, p_order_id uuid, p_order_data jsonb, p_items jsonb, p_warehouse_id uuid, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_existing_state text;
  v_reco_status text;
  v_reco_req uuid;
  v_err text;
  v_result jsonb;
  v_payment jsonb;
  v_i int := 0;
begin
  v_actor := auth.uid();
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be a json array';
  end if;

  if jsonb_typeof(coalesce(p_order_data, '{}'::jsonb)->'promotionLines') = 'array'
     and jsonb_array_length(coalesce(p_order_data, '{}'::jsonb)->'promotionLines') > 0 then
    raise exception 'POS offline promotions are not allowed';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e(value)
    where (e.value ? 'promotionId')
       or (e.value ? 'promotion_id')
       or lower(coalesce(e.value->>'lineType','')) = 'promotion'
       or lower(coalesce(e.value->>'line_type','')) = 'promotion'
  ) then
    raise exception 'POS offline promotions are not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_offline_id));

  select s.state, coalesce(s.reconciliation_status, 'NONE'), s.reconciliation_approval_request_id
  into v_existing_state, v_reco_status, v_reco_req
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if found and v_existing_state = 'DELIVERED' then
    return jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  end if;

  if found and v_existing_state in ('CONFLICT','FAILED') and v_reco_status <> 'APPROVED' then
    return jsonb_build_object(
      'status', 'REQUIRES_RECONCILIATION',
      'orderId', p_order_id::text,
      'offlineId', p_offline_id,
      'approvalRequestId', case when v_reco_req is null then null else v_reco_req::text end
    );
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'SYNCED', coalesce(p_order_data, '{}'::jsonb), v_actor, now(), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    state = case
      when public.pos_offline_sales.state = 'DELIVERED' then 'DELIVERED'
      else 'SYNCED'
    end,
    payload = excluded.payload,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    updated_at = now();

  select * from public.orders o where o.id = p_order_id for update;
  if not found then
    insert into public.orders(id, customer_auth_user_id, status, invoice_number, data, created_at, updated_at)
    values (
      p_order_id,
      v_actor,
      'pending',
      null,
      coalesce(p_order_data, '{}'::jsonb),
      now(),
      now()
    );
  else
    update public.orders
    set data = coalesce(p_order_data, data),
        updated_at = now()
    where id = p_order_id;
  end if;

  begin
    perform public.confirm_order_delivery(p_order_id, p_items, coalesce(p_order_data, '{}'::jsonb), p_warehouse_id);
  exception when others then
    v_err := sqlerrm;
    update public.pos_offline_sales
    set state = case
          when v_err ilike '%insufficient%' then 'CONFLICT'
          when v_err ilike '%expired%' then 'CONFLICT'
          when v_err ilike '%reservation%' then 'CONFLICT'
          else 'FAILED'
        end,
        last_error = v_err,
        reconciliation_status = case when v_existing_state in ('CONFLICT','FAILED') then 'NONE' else reconciliation_status end,
        reconciliation_approval_request_id = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciliation_approval_request_id end,
        reconciled_by = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciled_by end,
        reconciled_at = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciled_at end,
        updated_at = now()
    where offline_id = p_offline_id;
    update public.orders
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('CONFLICT'::text), true),
        updated_at = now()
    where id = p_order_id;
    return jsonb_build_object('status', 'CONFLICT', 'orderId', p_order_id::text, 'offlineId', p_offline_id, 'error', v_err);
  end;

  for v_payment in
    select value
    from jsonb_array_elements(p_payments)
  loop
    begin
      perform public.record_order_payment(
        p_order_id,
        coalesce(nullif(v_payment->>'amount','')::numeric, 0),
        coalesce(nullif(v_payment->>'method',''), ''),
        coalesce(nullif(v_payment->>'occurredAt','')::timestamptz, now()),
        'offline:' || p_offline_id || ':' || v_i::text
      );
    exception when others then
      null;
    end;
    v_i := v_i + 1;
  end loop;

  update public.pos_offline_sales
  set state = 'DELIVERED',
      last_error = null,
      updated_at = now()
  where offline_id = p_offline_id;

  update public.orders
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('DELIVERED'::text), true),
      updated_at = now()
  where id = p_order_id;

  v_result := jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_purchase_order_paid_amount_from_payments(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_sum numeric;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(po.total_amount, 0)
  into v_total
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    return;
  end if;

  select coalesce(sum(p.amount), 0)
  into v_sum
  from public.payments p
  where p.reference_table = 'purchase_orders'
    and p.direction = 'out'
    and p.reference_id = p_order_id::text;

  update public.purchase_orders po
  set paid_amount = least(coalesce(v_sum, 0), coalesce(v_total, 0)),
      updated_at = now()
  where po.id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_total_cost(p_transfer_id uuid)
 RETURNS numeric
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(quantity * unit_cost), 0)
  from public.inventory_transfer_items
  where transfer_id = p_transfer_id
$function$
;

CREATE OR REPLACE FUNCTION public.trg_after_journal_entry_insert_flag_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.source_table = 'payments' and new.source_event like 'in:orders:%' then
    perform public.flag_payment_allocation_status((new.source_id)::uuid);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_apply_import_shipment_landed_cost_on_delivered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_sm record;
  v_im record;
  v_avail numeric;
  v_total_current numeric;
  v_total_adjusted numeric;
  v_new_avg numeric;
begin
  if coalesce(new.destination_warehouse_id, '') is null then
    raise exception 'destination_warehouse_id is required to apply landed cost on delivered for shipment %', new.id;
  end if;
  perform public.calculate_shipment_landed_cost(new.id);
  for v_item in
    select isi.item_id::text as item_id_text,
           coalesce(isi.quantity, 0) as qty,
           coalesce(isi.landing_cost_per_unit, 0) as landed_unit
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
    select sm.*
    into v_sm
    from public.stock_management sm
    where (case
            when pg_typeof(sm.item_id)::text = 'uuid' then sm.item_id::text = v_item.item_id_text
            else sm.item_id::text = v_item.item_id_text
          end)
      and sm.warehouse_id = new.destination_warehouse_id
    for update;
    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item.item_id_text, new.destination_warehouse_id;
    end if;
    if v_sm.last_batch_id is null then
      raise exception 'Missing last_batch_id for item % in warehouse %', v_item.item_id_text, new.destination_warehouse_id;
    end if;
    select im.*
    into v_im
    from public.inventory_movements im
    where im.batch_id = v_sm.last_batch_id
      and im.movement_type = 'purchase_in'
    limit 1
    for update;
    if not found then
      raise exception 'Purchase-in movement for batch % not found (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    if coalesce(v_im.reference_table, '') <> 'purchase_receipts' then
      raise exception 'Last batch % is not linked to a receipt movement (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    if new.actual_arrival_date is not null and v_im.occurred_at < new.actual_arrival_date then
      raise exception 'Receipt movement for batch % predates shipment arrival (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    update public.inventory_movements
    set unit_cost = v_item.landed_unit,
        total_cost = (coalesce(v_im.quantity, 0) * v_item.landed_unit)
    where id = v_im.id;
    update public.batches b
    set unit_cost = v_item.landed_unit,
        updated_at = now()
    where b.item_id = v_item.item_id_text
      and b.warehouse_id = new.destination_warehouse_id
      and coalesce(b.quantity_consumed,0) < coalesce(b.quantity_received,0)
      and exists (
        select 1
        from public.inventory_movements im2
        where im2.batch_id = b.id
          and im2.movement_type = 'purchase_in'
          and im2.reference_table = 'purchase_receipts'
          and (new.actual_arrival_date is null or im2.occurred_at >= new.actual_arrival_date)
      );
    v_avail := coalesce(v_sm.available_quantity, 0);
    if v_avail > 0 then
      v_total_current := (coalesce(v_sm.avg_cost, 0) * v_avail);
      v_total_adjusted := v_total_current
                        - (coalesce(v_im.unit_cost, 0) * coalesce(v_im.quantity, 0))
                        + (v_item.landed_unit * coalesce(v_im.quantity, 0));
      v_new_avg := v_total_adjusted / v_avail;
      update public.stock_management
      set avg_cost = v_new_avg,
          updated_at = now(),
          last_updated = now()
      where id = v_sm.id;
    end if;
  end loop;
  return new;
exception
  when others then
    raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_batches_pricing_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cost numeric;
  v_margin numeric;
begin
  v_cost := coalesce(new.cost_per_unit, 0);
  if v_cost <= 0 then
    v_cost := coalesce(new.unit_cost, 0);
  end if;

  if coalesce(new.unit_cost, 0) <= 0 and v_cost > 0 then
    new.unit_cost := v_cost;
  end if;
  new.cost_per_unit := v_cost;

  v_margin := coalesce(new.min_margin_pct, 0);
  if v_margin <= 0 then
    v_margin := public._resolve_default_min_margin_pct(new.item_id, new.warehouse_id);
  end if;
  new.min_margin_pct := greatest(0, v_margin);

  new.min_selling_price := public._money_round(new.cost_per_unit * (1 + (new.min_margin_pct / 100)));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_journal_in_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_in_closed_period(new.entry_date) then
    raise exception 'accounting period is closed';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_journal_lines_in_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id uuid;
  v_date timestamptz;
begin
  v_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_entry_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select je.entry_date into v_date
  from public.journal_entries je
  where je.id = v_entry_id;
  if v_date is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if public.is_in_closed_period(v_date) then
    raise exception 'accounting period is closed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_manual_entry_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'not allowed';
  end if;

  if current_setting('app.accounting_bypass', true) = '1' then
    return new;
  end if;

  if old.source_table = 'manual' and old.status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_manual_line_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source_table text;
  v_status text;
begin
  if current_setting('app.accounting_bypass', true) = '1' then
    return coalesce(new, old);
  end if;

  select je.source_table, je.status
  into v_source_table, v_status
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_source_table = 'manual' and v_status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_sale_below_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
  v_order jsonb;
  v_line jsonb;
  v_unit_price numeric;
  v_item_id text;
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

  select o.data into v_order from public.orders o where o.id = (new.reference_id)::uuid;
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

  if v_unit_price + 1e-9 < coalesce(v_batch.min_selling_price, 0) then
    raise exception 'SELLING_BELOW_COST_NOT_ALLOWED';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_block_sale_on_qc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qc text;
  v_recall boolean;
begin
  if new.movement_type in ('sale_out','transfer_out') and new.batch_id is not null then
    select qc_status into v_qc from public.batches where id = new.batch_id;
    select exists(
      select 1 from public.batch_recalls br
      where br.batch_id = new.batch_id and br.status = 'active'
    ) into v_recall;
    if v_qc is distinct from 'released' or v_recall then
      raise exception 'batch not released or recalled';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_check_order_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_check_po_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_check_shift_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_check_simple_date_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_close_import_shipment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_sm record;
  v_im record;
  v_fob_total numeric;
begin
  if coalesce(new.status, '') <> 'closed' then return new; end if;
  if coalesce(old.status, '') = 'closed' then return new; end if;
  if new.destination_warehouse_id is null then raise exception 'destination_warehouse_id required'; end if;

  perform public.calculate_shipment_landed_cost(new.id);

  for v_item in
    select isi.item_id::text as item_id_text,
           coalesce(isi.quantity, 0) as qty,
           coalesce(isi.landing_cost_per_unit, 0) as landed_unit,
           coalesce(isi.unit_price_fob, 0) as fob_unit
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
    select sm.* into v_sm
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id_text
      and sm.warehouse_id = new.destination_warehouse_id
    for update;

    if found and v_sm.last_batch_id is not null then
      select im.* into v_im
      from public.inventory_movements im
      where im.batch_id = v_sm.last_batch_id
        and im.movement_type = 'purchase_in'
      limit 1 for update;

      if found then
         -- Update Purchase Movement
         v_fob_total := v_item.fob_unit * coalesce(v_im.quantity, 0);
         
         update public.inventory_movements
         set unit_cost = v_item.landed_unit,
             total_cost = (coalesce(v_im.quantity, 0) * v_item.landed_unit),
             data = jsonb_set(coalesce(data, '{}'::jsonb), '{fob_total}', to_jsonb(v_fob_total))
         where id = v_im.id;

         perform public.post_inventory_movement(v_im.id);

         -- Update Batch
         update public.batches
         set unit_cost = v_item.landed_unit,
             updated_at = now()
         where id = v_sm.last_batch_id;

         -- Fix Retroactive COGS
         perform public.fix_retroactive_cogs(
           v_sm.last_batch_id, 
           v_item.landed_unit, 
           'import_shipments', 
           new.id::text, 
           new.reference_number
         );
      end if;
    end if;
  end loop;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_approval_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from public.approval_requests where id = new.request_id;
  if v_branch is not null then
    if exists (
      select 1 from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.branch_id is distinct from v_branch
    ) then
      raise exception 'cross-branch approval is not allowed';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_base_currency_singleton()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_discount_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.discount_requires_approval and new.discount_approval_status <> 'approved' then
    if new.status in ('delivered','out_for_delivery','completed') then
      raise exception 'order discount requires approval';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_po_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_required boolean;
begin
  if tg_op = 'UPDATE' and new.status = 'completed' then
    v_required := public.approval_required('po', new.total_amount);
    new.requires_approval := v_required;
    if v_required and new.approval_status <> 'approved' then
      raise exception 'purchase order requires approval';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_receipt_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_required boolean;
begin
  select coalesce(total_amount, 0) into v_total
  from public.purchase_orders
  where id = new.purchase_order_id;

  v_required := public.approval_required('receipt', v_total);
  new.requires_approval := v_required;

  if v_required and new.approval_status <> 'approved' then
    raise exception 'purchase receipt requires approval';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_transfer_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_required boolean;
begin
  v_total := public.transfer_total_cost(new.id);
  v_required := public.approval_required('transfer', v_total);
  new.requires_approval := v_required;

  if (new.state in ('IN_TRANSIT','RECEIVED')) and v_required and new.approval_status <> 'approved' then
    raise exception 'transfer requires approval';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enforce_writeoff_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_required boolean;
begin
  if new.movement_type in ('wastage_out','adjust_out') then
    v_required := public.approval_required('writeoff', new.total_cost);
    new.requires_approval := v_required;
    if v_required and new.approval_status <> 'approved' then
      raise exception 'writeoff requires approval';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_forbid_update_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'immutable_record';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_freeze_ledger_tables()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cmd record;
  v_allow text;
begin
  v_allow := current_setting('app.allow_ledger_ddl', true);
  if v_allow = '1' then
    return;
  end if;
  for v_cmd in select * from pg_event_trigger_ddl_commands()
  loop
    if v_cmd.object_type in ('table','trigger','function')
      and coalesce(v_cmd.schema_name,'') = 'public'
      and (
        v_cmd.object_identity like '%public.accounting_documents%'
        or v_cmd.object_identity like '%public.journal_entries%'
        or v_cmd.object_identity like '%public.journal_lines%'
      )
    then
      raise exception 'ledger ddl frozen';
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_immutable_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'immutable record';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_inventory_movements_purchase_in_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh uuid;
begin
  if new.movement_type = 'purchase_in' then
    if auth.uid() is null then
      raise exception 'not authenticated';
    end if;
    if not public.has_admin_permission('stock.manage') then
      raise exception 'not allowed';
    end if;
    if new.batch_id is null then
      raise exception 'purchase_in requires batch_id';
    end if;
    if new.warehouse_id is null then
      v_wh := public._resolve_default_warehouse_id();
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
      new.warehouse_id := v_wh;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_journal_entries_set_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
  v_company uuid;
  v_doc_type text;
begin
  if new.branch_id is null then
    if new.source_table = 'inventory_movements' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_movements where id = new.source_id::uuid;
      v_doc_type := 'movement';
    elsif new.source_table = 'purchase_receipts' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_receipts where id = new.source_id::uuid;
      v_doc_type := 'grn';
    elsif new.source_table = 'supplier_invoices' then
      select branch_id, company_id into v_branch, v_company
      from public.supplier_invoices where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'payments' then
      select branch_id, company_id into v_branch, v_company
      from public.payments where id = new.source_id::uuid;
      v_doc_type := 'payment';
    elsif new.source_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'manual' then
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'manual';
    else
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'movement';
    end if;
    new.branch_id := coalesce(new.branch_id, v_branch);
    new.company_id := coalesce(new.company_id, v_company);
  end if;
  if new.document_id is null then
    new.document_id := public.create_accounting_document(
      coalesce(v_doc_type, 'movement'),
      coalesce(new.source_table, 'manual'),
      coalesce(new.source_id, new.id::text),
      new.branch_id,
      new.company_id,
      new.memo
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_journal_lines_sync_ar_open_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry record;
begin
  select je.source_table, je.source_id, je.source_event
  into v_entry
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id)
  limit 1;

  if v_entry.source_table = 'orders' and v_entry.source_event in ('invoiced','delivered') then
    begin
      perform public.sync_ar_on_invoice((v_entry.source_id)::uuid);
    exception when others then
      null;
    end;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_lock_approval_requests()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval request is immutable';
  end if;

  if new.id <> old.id
     or new.target_table <> old.target_table
     or new.target_id <> old.target_id
     or new.request_type <> old.request_type
     or new.requested_by <> old.requested_by
     or new.payload_hash <> old.payload_hash
     or new.created_at <> old.created_at then
    raise exception 'approval request is immutable';
  end if;

  if old.status <> 'pending' then
    raise exception 'approval request already finalized';
  end if;

  if new.status = 'pending' then
    if new.approved_by is not null or new.approved_at is not null or new.rejected_by is not null or new.rejected_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  if new.status = 'approved' then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'approval request missing approved_by/approved_at';
    end if;
    if new.rejected_by is not null or new.rejected_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  if new.status = 'rejected' then
    if new.rejected_by is null or new.rejected_at is null then
      raise exception 'approval request missing rejected_by/rejected_at';
    end if;
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'approval request is immutable';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_lock_approval_steps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval step is immutable';
  end if;

  if new.id <> old.id
     or new.request_id <> old.request_id
     or new.step_no <> old.step_no
     or new.approver_role <> old.approver_role then
    raise exception 'approval step is immutable';
  end if;

  if old.status <> 'pending' then
    raise exception 'approval step already finalized';
  end if;

  if new.status = 'pending' then
    if new.action_by is not null or new.action_at is not null then
      raise exception 'approval step is immutable';
    end if;
  end if;

  if new.status in ('approved', 'rejected') then
    if new.action_by is null or new.action_at is null then
      raise exception 'approval step missing action_by/action_at';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_promotion_guards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_has_promos boolean;
  v_coupon text;
  v_points numeric;
begin
  v_has_promos := (jsonb_typeof(coalesce(new.data->'promotionLines', '[]'::jsonb)) = 'array')
                  and (jsonb_array_length(coalesce(new.data->'promotionLines', '[]'::jsonb)) > 0);
  if not v_has_promos then
    return new;
  end if;

  v_coupon := nullif(btrim(coalesce(new.data->>'appliedCouponCode', new.data->>'couponCode', '')), '');
  if v_coupon is not null then
    raise exception 'promotion_coupon_conflict';
  end if;

  v_points := coalesce(nullif((new.data->>'pointsRedeemedValue')::numeric, null), 0);
  if v_points > 0 then
    raise exception 'promotion_points_conflict';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_require_sale_out_on_delivered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    if not exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = new.id::text
        and im.movement_type = 'sale_out'
    ) then
      raise exception 'cannot mark delivered without stock movements';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_post_inventory_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.post_inventory_movement(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_post_order_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    perform public.post_order_delivery(new.id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_post_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.post_payment(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_promotion_items_lock_after_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_promotion_usage_enforce_valid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_promotions_enforce_active_window_and_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.is_active then
      if new.approval_status <> 'approved' then
        raise exception 'promotion_requires_approval';
      end if;
      if now() > new.end_at then
        raise exception 'promotion_already_ended';
      end if;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_promotions_lock_after_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trg_purchase_items_set_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po record;
begin
  select * into v_po from public.purchase_orders po where po.id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if v_po.id is null then
    raise exception 'purchase order not found';
  end if;
  if v_po.currency is null then
    raise exception 'purchase order currency missing';
  end if;
  if v_po.fx_rate is null then
    raise exception 'purchase order fx rate missing';
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if new.unit_cost_foreign is null then
      new.unit_cost_foreign := coalesce(new.unit_cost, 0);
    end if;
    new.unit_cost_base := coalesce(new.unit_cost_foreign, 0) * coalesce(v_po.fx_rate, 0);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_purchase_orders_fx_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base text;
begin
  v_base := public.get_base_currency();
  if tg_op = 'INSERT' then
    if new.currency is null then
      raise exception 'currency required';
    end if;
    if new.fx_rate is null then
      raise exception 'fx rate required';
    end if;
    new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (new.status = 'completed') and (old.status is distinct from 'completed') then
      if new.currency is null or new.fx_rate is null then
        raise exception 'currency/fx_rate required to complete PO';
      end if;
      new.fx_locked := true;
    end if;
    if coalesce(old.fx_locked, false) = true then
      if new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate then
        raise exception 'fx locked: currency/fx_rate cannot change after completion';
      end if;
    end if;
    new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
    return new;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_recall_batch_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'active' then
    update public.batches set qc_status = 'recalled' where id = new.batch_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_approval_request_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.branch_id is null then
    if new.target_table = 'purchase_orders' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_orders where id = new.target_id::uuid;
    elsif new.target_table = 'purchase_receipts' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_receipts where id = new.target_id::uuid;
    elsif new.target_table = 'inventory_transfers' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_transfers where id = new.target_id::uuid;
    elsif new.target_table = 'inventory_movements' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_movements where id = new.target_id::uuid;
    elsif new.target_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = new.target_id::uuid;
    end if;
    new.branch_id := coalesce(v_branch, public.get_default_branch_id());
    new.company_id := coalesce(v_company, public.company_from_branch(new.branch_id), public.get_default_company_id());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_journal_entry_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.source_table = 'manual' then
    new.status := 'draft';
  else
    new.status := coalesce(nullif(new.status, ''), 'posted');
    if new.status = 'draft' then
      new.status := 'posted';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_movement_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_order_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.warehouse_id is null then
    if nullif(new.data->>'warehouseId','') is not null and (new.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      new.warehouse_id := (new.data->>'warehouseId')::uuid;
    else
      select id into new.warehouse_id
      from public.warehouses
      where is_active = true
      order by created_at asc
      limit 1;
    end if;
  end if;
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_order_fx()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  $function$
;

CREATE OR REPLACE FUNCTION public.trg_set_payment_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.branch_id is null then
    if new.reference_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = nullif(new.reference_id, '')::uuid;
    elsif new.reference_table = 'purchase_orders' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_orders where id = nullif(new.reference_id, '')::uuid;
    elsif new.reference_table = 'expenses' then
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
    end if;
    new.branch_id := coalesce(new.branch_id, v_branch, public.get_default_branch_id());
    new.company_id := coalesce(new.company_id, v_company, public.company_from_branch(new.branch_id), public.get_default_company_id());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_payment_fx()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rate numeric;
begin
  if new.currency is null then
    raise exception 'currency required';
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.fx_locked,true) then
    if new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate then
      raise exception 'fx locked: cannot change currency/fx_rate';
    end if;
  end if;
  new.base_amount := coalesce(new.amount, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_po_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.warehouse_id is null then
    select id into new.warehouse_id
    from public.warehouses
    where is_active = true
    order by created_at asc
    limit 1;
  end if;
  v_branch := public.branch_from_warehouse(new.warehouse_id);
  if v_branch is null then
    v_branch := public.get_default_branch_id();
  end if;
  new.branch_id := coalesce(new.branch_id, v_branch);
  v_company := public.company_from_branch(new.branch_id);
  new.company_id := coalesce(new.company_id, v_company, public.get_default_company_id());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_qty_base_inventory_movements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_qty_base_purchase_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_qty_base_receipt_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_qty_base_transfer_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_receipt_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po record;
begin
  select * into v_po from public.purchase_orders where id = new.purchase_order_id;
  if new.warehouse_id is null then
    new.warehouse_id := v_po.warehouse_id;
  end if;
  new.branch_id := coalesce(new.branch_id, v_po.branch_id, public.branch_from_warehouse(new.warehouse_id));
  new.company_id := coalesce(new.company_id, v_po.company_id, public.company_from_branch(new.branch_id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_supplier_invoice_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.branch_id is null then
    new.branch_id := public.get_default_branch_id();
  end if;
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_set_transfer_branch_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.from_warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_discount_approval_to_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.request_type = 'discount'
     and new.target_table = 'orders'
     and new.status is distinct from old.status then
    update public.orders
    set
      discount_requires_approval = true,
      discount_approval_status = new.status,
      discount_approval_request_id = new.id
    where id::text = new.target_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_discount_approval_to_promotion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.request_type = 'discount'
     and new.target_table = 'promotions'
     and new.status is distinct from old.status then
    update public.promotions
    set
      requires_approval = true,
      approval_status = new.status,
      approval_request_id = new.id,
      updated_at = now()
    where id::text = new.target_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_offline_reconciliation_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.request_type = 'offline_reconciliation'
     and new.target_table = 'pos_offline_sales'
     and new.status is distinct from old.status then
    update public.pos_offline_sales
    set reconciliation_status = upper(new.status),
        reconciliation_approval_request_id = new.id,
        reconciled_by = case
          when new.status = 'approved' then new.approved_by
          when new.status = 'rejected' then new.rejected_by
          else null
        end,
        reconciled_at = case
          when new.status = 'approved' then new.approved_at
          when new.status = 'rejected' then new.rejected_at
          else null
        end,
        updated_at = now()
    where offline_id = new.target_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_order_line_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.rebuild_order_line_items(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_po_approval_to_purchase_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po_id uuid;
  v_all_received boolean := true;
  v_item record;
  v_total numeric;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.target_table <> 'purchase_orders'
     or new.request_type <> 'po'
     or new.status is not distinct from old.status then
    return new;
  end if;
  begin
    v_po_id := nullif(trim(coalesce(new.target_id, '')), '')::uuid;
  exception when others then
    return new;
  end;
  select coalesce(total_amount, 0)
  into v_total
  from public.purchase_orders
  where id = v_po_id;
  if not found then
    return new;
  end if;
  update public.purchase_orders
  set approval_status = new.status,
      approval_request_id = new.id,
      requires_approval = public.approval_required('po', v_total),
      updated_at = now()
  where id = v_po_id;
  if new.status <> 'approved' then
    return new;
  end if;
  for v_item in
    select coalesce(pi.quantity, 0) as ordered, coalesce(pi.received_quantity, 0) as received
    from public.purchase_items pi
    where pi.purchase_order_id = v_po_id
  loop
    if (coalesce(v_item.received, 0) + 1e-9) < coalesce(v_item.ordered, 0) then
      v_all_received := false;
      exit;
    end if;
  end loop;
  if v_all_received then
    update public.purchase_orders
    set status = 'completed',
        approval_status = 'approved',
        approval_request_id = new.id,
        requires_approval = public.approval_required('po', v_total),
        updated_at = now()
    where id = v_po_id
      and status = 'partial';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_purchase_order_paid_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_old_id uuid;
  v_new_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    begin
      v_old_id := nullif(trim(coalesce(old.reference_id, '')), '')::uuid;
    exception when others then
      return old;
    end;
    if old.reference_table = 'purchase_orders' and old.direction = 'out' then
      perform public.sync_purchase_order_paid_amount_from_payments(v_old_id);
    end if;
    return old;
  end if;

  if new.reference_table is distinct from 'purchase_orders' or new.direction is distinct from 'out' then
    return new;
  end if;

  begin
    v_new_id := nullif(trim(coalesce(new.reference_id, '')), '')::uuid;
  exception when others then
    raise exception 'invalid purchase order reference_id';
  end;

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = v_new_id;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot record payment for cancelled purchase order';
  end if;

  if tg_op = 'UPDATE' and (new.reference_id is distinct from old.reference_id) then
    begin
      v_old_id := nullif(trim(coalesce(old.reference_id, '')), '')::uuid;
    exception when others then
      v_old_id := null;
    end;
    if v_old_id is not null then
      perform public.sync_purchase_order_paid_amount_from_payments(v_old_id);
    end if;
  end if;

  perform public.sync_purchase_order_paid_amount_from_payments(v_new_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_trace_batch_sales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.movement_type = 'sale_out' and new.batch_id is not null and new.reference_table = 'orders' then
    insert into public.batch_sales_trace(batch_id, order_id, quantity, sold_at)
    values (new.batch_id, new.reference_id::uuid, new.quantity, new.occurred_at);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_validate_base_currency_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.get_base_currency();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_validate_reserved_batches()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
  v_qc text;
  v_recall boolean;
begin
  if jsonb_typeof(new.data->'reservedBatches') = 'object' then
    for v_key in select key from jsonb_each(new.data->'reservedBatches')
    loop
      select qc_status into v_qc from public.batches where id = v_key::uuid;
      select exists(
        select 1 from public.batch_recalls br
        where br.batch_id = v_key::uuid and br.status = 'active'
      ) into v_recall;
      if v_qc is distinct from 'released' or v_recall then
        raise exception 'reserved batch not released or recalled';
      end if;
    end loop;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trial_balance(p_start date, p_end date, p_cost_center_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(account_code text, account_name text, account_type text, normal_balance text, debit numeric, credit numeric, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(jl.debit), 0) as debit,
    coalesce(sum(jl.credit), 0) as credit,
    coalesce(sum(jl.debit - jl.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and (p_start is null or je.entry_date::date >= p_start)
   and (p_end is null or je.entry_date::date <= p_end)
  where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_encrypt_customer_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  -- Encrypt Phone if changed
  IF NEW.phone_number IS NOT NULL AND (OLD.phone_number IS NULL OR NEW.phone_number <> OLD.phone_number) THEN
    NEW.phone_encrypted := public.encrypt_text(NEW.phone_number);
  END IF;

  -- Encrypt Address if changed (assuming address is in data->>'address')
  IF (NEW.data->>'address') IS NOT NULL AND (OLD.data IS NULL OR (NEW.data->>'address') <> (OLD.data->>'address')) THEN
    NEW.address_encrypted := public.encrypt_text(NEW.data->>'address');
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_promotion(p_promotion jsonb, p_items jsonb, p_activate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_promo_id uuid;
  v_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_is_active boolean;
  v_discount_mode text;
  v_fixed_total numeric;
  v_percent_off numeric;
  v_display_original_total numeric;
  v_max_uses int;
  v_exclusive_with_coupon boolean;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_sort int;
  v_snapshot jsonb;
  v_promo_expense numeric;
  v_requires_approval boolean;
  v_req_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_promotion is null then
    raise exception 'p_promotion is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  v_promo_id := public._uuid_or_null(p_promotion->>'id');
  v_name := nullif(btrim(coalesce(p_promotion->>'name','')), '');
  v_start_at := nullif(p_promotion->>'startAt','')::timestamptz;
  v_end_at := nullif(p_promotion->>'endAt','')::timestamptz;
  v_discount_mode := nullif(btrim(coalesce(p_promotion->>'discountMode','')), '');
  v_fixed_total := nullif((p_promotion->>'fixedTotal')::numeric, null);
  v_percent_off := nullif((p_promotion->>'percentOff')::numeric, null);
  v_display_original_total := nullif((p_promotion->>'displayOriginalTotal')::numeric, null);
  v_max_uses := nullif((p_promotion->>'maxUses')::int, null);
  v_exclusive_with_coupon := coalesce((p_promotion->>'exclusiveWithCoupon')::boolean, true);

  if v_name is null then
    raise exception 'name is required';
  end if;
  if v_start_at is null or v_end_at is null then
    raise exception 'startAt/endAt are required';
  end if;
  if v_start_at >= v_end_at then
    raise exception 'startAt must be before endAt';
  end if;
  if v_discount_mode not in ('fixed_total','percent_off') then
    raise exception 'invalid discountMode';
  end if;
  if v_discount_mode = 'fixed_total' then
    if v_fixed_total is null or v_fixed_total <= 0 then
      raise exception 'fixedTotal must be positive';
    end if;
    v_percent_off := null;
  else
    if v_percent_off is null or v_percent_off <= 0 or v_percent_off > 100 then
      raise exception 'percentOff must be between 0 and 100';
    end if;
    v_fixed_total := null;
  end if;

  if v_promo_id is null then
    insert into public.promotions(
      name, start_at, end_at, is_active,
      discount_mode, fixed_total, percent_off,
      display_original_total, max_uses, exclusive_with_coupon,
      created_by, data
    )
    values (
      v_name, v_start_at, v_end_at, false,
      v_discount_mode, v_fixed_total, v_percent_off,
      v_display_original_total, v_max_uses, v_exclusive_with_coupon,
      v_actor, coalesce(p_promotion->'data', '{}'::jsonb)
    )
    returning id into v_promo_id;
  else
    update public.promotions
    set
      name = v_name,
      start_at = v_start_at,
      end_at = v_end_at,
      discount_mode = v_discount_mode,
      fixed_total = v_fixed_total,
      percent_off = v_percent_off,
      display_original_total = v_display_original_total,
      max_uses = v_max_uses,
      exclusive_with_coupon = v_exclusive_with_coupon,
      data = coalesce(p_promotion->'data', data),
      updated_at = now()
    where id = v_promo_id;

    if not found then
      raise exception 'promotion_not_found';
    end if;
  end if;

  delete from public.promotion_items where promotion_id = v_promo_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(coalesce(v_item->>'itemId','')), '');
    v_qty := coalesce(nullif((v_item->>'quantity')::numeric, null), 0);
    v_sort := coalesce(nullif((v_item->>'sortOrder')::int, null), 0);
    if v_item_id is null then
      raise exception 'itemId is required';
    end if;
    if v_qty <= 0 then
      raise exception 'quantity must be positive';
    end if;

    insert into public.promotion_items(promotion_id, item_id, quantity, sort_order)
    values (v_promo_id, v_item_id, v_qty, v_sort);
  end loop;

  if coalesce(p_activate, false) then
    v_snapshot := public._compute_promotion_snapshot(v_promo_id, null, null, 1, null, false);
    v_promo_expense := coalesce(nullif((v_snapshot->>'promotionExpense')::numeric, null), 0);
    v_requires_approval := public.approval_required('discount', v_promo_expense);

    if v_requires_approval then
      v_req_id := public.create_approval_request(
        'promotions',
        v_promo_id::text,
        'discount',
        v_promo_expense,
        jsonb_build_object(
          'promotionId', v_promo_id::text,
          'name', v_name,
          'promotionExpense', v_promo_expense,
          'snapshot', v_snapshot
        )
      );

      update public.promotions
      set
        requires_approval = true,
        approval_status = 'pending',
        approval_request_id = v_req_id,
        is_active = false,
        updated_at = now()
      where id = v_promo_id;
    else
      update public.promotions
      set
        requires_approval = false,
        approval_status = 'approved',
        approval_request_id = null,
        is_active = true,
        updated_at = now()
      where id = v_promo_id;
    end if;
  end if;

  return jsonb_build_object(
    'promotionId', v_promo_id::text,
    'approvalRequestId', case when v_req_id is null then null else v_req_id::text end,
    'approvalStatus', (select p.approval_status from public.promotions p where p.id = v_promo_id),
    'isActive', (select p.is_active from public.promotions p where p.id = v_promo_id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.uuid_from_text(p_text text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (
    substr(md5(coalesce(p_text,'')), 1, 8) || '-' ||
    substr(md5(coalesce(p_text,'')), 9, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 13, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 17, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 21, 12)
  )::uuid;
$function$
;

create or replace view "public"."v_batch_balances" as  SELECT item_id,
    id AS batch_id,
    warehouse_id,
    expiry_date,
    GREATEST((COALESCE(quantity_received, (0)::numeric) - COALESCE(quantity_consumed, (0)::numeric)), (0)::numeric) AS remaining_qty
   FROM public.batches b;


create or replace view "public"."v_food_batch_balances" as  SELECT item_id,
    id AS batch_id,
    expiry_date,
    COALESCE(quantity_received, (0)::numeric) AS received_qty,
    COALESCE(quantity_consumed, (0)::numeric) AS consumed_qty,
    GREATEST((COALESCE(quantity_received, (0)::numeric) - COALESCE(quantity_consumed, (0)::numeric)), (0)::numeric) AS remaining_qty,
    warehouse_id
   FROM public.batches b
  WHERE (id IS NOT NULL);


create or replace view "public"."v_sellable_products" as  WITH stock AS (
         SELECT sm.item_id,
            sum(COALESCE(sm.available_quantity, (0)::numeric)) AS available_quantity
           FROM public.stock_management sm
          GROUP BY sm.item_id
        ), valid_batches AS (
         SELECT b.item_id,
            bool_or(((GREATEST(((COALESCE(b.quantity_received, (0)::numeric) - COALESCE(b.quantity_consumed, (0)::numeric)) - COALESCE(b.quantity_transferred, (0)::numeric)), (0)::numeric) > (0)::numeric) AND (COALESCE(b.status, 'active'::text) = 'active'::text) AND (COALESCE(b.qc_status, ''::text) = 'released'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM public.batch_recalls br
                  WHERE ((br.batch_id = b.id) AND (br.status = 'active'::text))))) AND ((b.expiry_date IS NULL) OR (b.expiry_date >= CURRENT_DATE)))) AS has_valid_batch
           FROM public.batches b
          GROUP BY b.item_id
        )
 SELECT mi.id,
    mi.name,
    mi.barcode,
    mi.price,
    mi.base_unit,
    mi.is_food,
    mi.expiry_required,
    mi.sellable,
    mi.status,
    COALESCE(s.available_quantity, (0)::numeric) AS available_quantity,
    mi.category,
    mi.is_featured,
    mi.freshness_level,
    mi.data
   FROM ((public.menu_items mi
     LEFT JOIN stock s ON ((s.item_id = mi.id)))
     LEFT JOIN valid_batches vb ON ((vb.item_id = mi.id)))
  WHERE ((mi.status = 'active'::text) AND (mi.sellable = true) AND (COALESCE(s.available_quantity, (0)::numeric) > (0)::numeric) AND ((mi.expiry_required = false) OR (COALESCE(vb.has_valid_batch, false) = true)));


CREATE OR REPLACE FUNCTION public.void_delivered_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_delivered_entry_id uuid;
  v_void_entry_id uuid;
  v_line record;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
  v_sale record;
  v_ret_batch_id uuid;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
  v_data jsonb;
begin
  perform public._require_staff('void_delivered_order');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.void')) then
    raise exception 'not authorized';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'order not found';
  end if;
  if coalesce(v_order.status,'') <> 'delivered' then
    raise exception 'only delivered orders can be voided';
  end if;

  if coalesce(v_order.data->>'voidedAt','') <> '' then
    raise exception 'order already voided';
  end if;

  select je.id
  into v_delivered_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event = 'delivered'
  limit 1;
  if not found then
    raise exception 'delivered journal entry not found';
  end if;

  select je.id
  into v_void_entry_id
  from public.journal_entries je
  where je.source_table = 'order_voids'
    and je.source_id = p_order_id::text
    and je.source_event = 'voided'
  limit 1;

  if v_void_entry_id is null then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (
      now(),
      concat('Void delivered order ', p_order_id::text),
      'order_voids',
      p_order_id::text,
      'voided',
      auth.uid(),
      'posted'
    )
    returning id into v_void_entry_id;
  else
    update public.journal_entries
    set entry_date = now(),
        memo = concat('Void delivered order ', p_order_id::text)
    where id = v_void_entry_id;
  end if;

  delete from public.journal_lines jl where jl.journal_entry_id = v_void_entry_id;

  for v_line in
    select account_id, debit, credit, line_memo
    from public.journal_lines
    where journal_entry_id = v_delivered_entry_id
  loop
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_void_entry_id,
      v_line.account_id,
      coalesce(v_line.credit,0),
      coalesce(v_line.debit,0),
      coalesce(v_line.line_memo,'')
    );
  end loop;

  v_ar_id := public.get_account_id_by_code('1200');
  if v_ar_id is not null then
    select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
    into v_ar_amount
    from public.journal_lines jl
    where jl.journal_entry_id = v_delivered_entry_id
      and jl.account_id = v_ar_id;
    v_ar_amount := greatest(0, coalesce(v_ar_amount, 0));
  end if;

  for v_sale in
    select im.id, im.item_id, im.quantity, im.unit_cost, im.batch_id, im.warehouse_id, im.occurred_at
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'sale_out'
    order by im.occurred_at asc, im.id asc
  loop
    select b.expiry_date, b.production_date, b.unit_cost
    into v_source_batch
    from public.batches b
    where b.id = v_sale.batch_id;

    v_wh := v_sale.warehouse_id;
    if v_wh is null then
      v_wh := coalesce(v_order.warehouse_id, public._resolve_default_admin_warehouse_id());
    end if;
    if v_wh is null then
      raise exception 'warehouse_id is required';
    end if;

    v_ret_batch_id := gen_random_uuid();
    insert into public.batches(
      id,
      item_id,
      receipt_item_id,
      receipt_id,
      warehouse_id,
      batch_code,
      production_date,
      expiry_date,
      quantity_received,
      quantity_consumed,
      unit_cost,
      qc_status,
      data
    )
    values (
      v_ret_batch_id,
      v_sale.item_id::text,
      null,
      null,
      v_wh,
      null,
      v_source_batch.production_date,
      v_source_batch.expiry_date,
      v_sale.quantity,
      0,
      coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
      'released',
      jsonb_build_object(
        'source', 'orders',
        'event', 'voided',
        'orderId', p_order_id::text,
        'sourceBatchId', v_sale.batch_id::text,
        'sourceMovementId', v_sale.id::text
      )
    );

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_sale.item_id::text,
      'return_in',
      v_sale.quantity,
      coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
      v_sale.quantity * coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
      'orders',
      p_order_id::text,
      now(),
      auth.uid(),
      jsonb_build_object(
        'orderId', p_order_id::text,
        'warehouseId', v_wh::text,
        'event', 'voided',
        'sourceBatchId', v_sale.batch_id::text,
        'sourceMovementId', v_sale.id::text
      ),
      v_ret_batch_id,
      v_wh
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
    perform public.recompute_stock_for_item(v_sale.item_id::text, v_wh);
  end loop;

  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_data := jsonb_set(v_data, '{voidedAt}', to_jsonb(now()::text), true);
  if nullif(trim(coalesce(p_reason,'')),'') is not null then
    v_data := jsonb_set(v_data, '{voidReason}', to_jsonb(p_reason), true);
  end if;
  v_data := jsonb_set(v_data, '{voidedBy}', to_jsonb(auth.uid()::text), true);

  update public.orders
  set data = v_data,
      updated_at = now()
  where id = p_order_id;

  perform public._apply_ar_open_item_credit(p_order_id, v_ar_amount);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.void_journal_entry(p_entry_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry public.journal_entries%rowtype;
  v_new_entry_id uuid;
  v_line record;
  v_reason text;
begin
  if not public.has_admin_permission('accounting.void') then
    raise exception 'not allowed';
  end if;
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if v_entry.source_table = 'manual' and v_entry.status = 'draft' then
    raise exception 'not allowed';
  end if;
  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then
    raise exception 'reason required';
  end if;
  perform public.set_audit_reason(v_reason);

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = v_reason
  where id = p_entry_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (now(), concat('Void ', p_entry_id::text, ' ', coalesce(v_entry.memo,'')), 'journal_entries', p_entry_id::text, 'void', auth.uid())
  returning id into v_new_entry_id;

  for v_line in
    select account_id, debit, credit, line_memo, cost_center_id from public.journal_lines where journal_entry_id = p_entry_id
  loop
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
    values (v_new_entry_id, v_line.account_id, v_line.credit, v_line.debit, coalesce(v_line.line_memo,'') || ' (reversal)', v_line.cost_center_id);
  end loop;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('journal_entries.void', 'accounting', p_entry_id::text, auth.uid(), now(),
          jsonb_build_object('voidOf', p_entry_id::text, 'newEntryId', v_new_entry_id::text),
          'HIGH', v_reason);
  return v_new_entry_id;
end;
$function$
;

grant delete on table "public"."purchase_receipt_expenses" to "anon";

grant insert on table "public"."purchase_receipt_expenses" to "anon";

grant references on table "public"."purchase_receipt_expenses" to "anon";

grant select on table "public"."purchase_receipt_expenses" to "anon";

grant trigger on table "public"."purchase_receipt_expenses" to "anon";

grant truncate on table "public"."purchase_receipt_expenses" to "anon";

grant update on table "public"."purchase_receipt_expenses" to "anon";

grant delete on table "public"."purchase_receipt_expenses" to "authenticated";

grant insert on table "public"."purchase_receipt_expenses" to "authenticated";

grant references on table "public"."purchase_receipt_expenses" to "authenticated";

grant select on table "public"."purchase_receipt_expenses" to "authenticated";

grant trigger on table "public"."purchase_receipt_expenses" to "authenticated";

grant truncate on table "public"."purchase_receipt_expenses" to "authenticated";

grant update on table "public"."purchase_receipt_expenses" to "authenticated";

grant delete on table "public"."purchase_receipt_expenses" to "service_role";

grant insert on table "public"."purchase_receipt_expenses" to "service_role";

grant references on table "public"."purchase_receipt_expenses" to "service_role";

grant select on table "public"."purchase_receipt_expenses" to "service_role";

grant trigger on table "public"."purchase_receipt_expenses" to "service_role";

grant truncate on table "public"."purchase_receipt_expenses" to "service_role";

grant update on table "public"."purchase_receipt_expenses" to "service_role";

grant delete on table "public"."reservation_lines" to "anon";

grant insert on table "public"."reservation_lines" to "anon";

grant references on table "public"."reservation_lines" to "anon";

grant select on table "public"."reservation_lines" to "anon";

grant trigger on table "public"."reservation_lines" to "anon";

grant truncate on table "public"."reservation_lines" to "anon";

grant update on table "public"."reservation_lines" to "anon";

grant delete on table "public"."reservation_lines" to "authenticated";

grant insert on table "public"."reservation_lines" to "authenticated";

grant references on table "public"."reservation_lines" to "authenticated";

grant select on table "public"."reservation_lines" to "authenticated";

grant trigger on table "public"."reservation_lines" to "authenticated";

grant truncate on table "public"."reservation_lines" to "authenticated";

grant update on table "public"."reservation_lines" to "authenticated";

grant delete on table "public"."reservation_lines" to "service_role";

grant insert on table "public"."reservation_lines" to "service_role";

grant references on table "public"."reservation_lines" to "service_role";

grant select on table "public"."reservation_lines" to "service_role";

grant trigger on table "public"."reservation_lines" to "service_role";

grant truncate on table "public"."reservation_lines" to "service_role";

grant update on table "public"."reservation_lines" to "service_role";


  create policy "journal_entries_admin_select"
  on "public"."journal_entries"
  as permissive
  for select
  to public
using (public.has_admin_permission('accounting.view'::text));



  create policy "journal_entries_admin_write"
  on "public"."journal_entries"
  as permissive
  for all
  to public
using (public.has_admin_permission('accounting.manage'::text))
with check (public.has_admin_permission('accounting.manage'::text));



  create policy "journal_lines_admin_select"
  on "public"."journal_lines"
  as permissive
  for select
  to public
using (public.has_admin_permission('accounting.view'::text));



  create policy "journal_lines_admin_write"
  on "public"."journal_lines"
  as permissive
  for all
  to public
using (public.has_admin_permission('accounting.manage'::text))
with check (public.has_admin_permission('accounting.manage'::text));



  create policy "reservation_lines_read_staff"
  on "public"."reservation_lines"
  as permissive
  for select
  to public
using ((public.is_staff() OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = reservation_lines.order_id) AND (o.customer_auth_user_id = auth.uid()))))));



  create policy "reservation_lines_write_staff"
  on "public"."reservation_lines"
  as permissive
  for all
  to public
using (public.is_staff());



  create policy "order_events_select_permissions"
  on "public"."order_events"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_events.order_id) AND ((o.customer_auth_user_id = auth.uid()) OR ((EXISTS ( SELECT 1
           FROM public.admin_users au
          WHERE ((au.auth_user_id = auth.uid()) AND (au.is_active = true) AND (au.role <> 'delivery'::text)))) AND public.has_admin_permission('orders.view'::text)) OR ((EXISTS ( SELECT 1
           FROM public.admin_users au
          WHERE ((au.auth_user_id = auth.uid()) AND (au.is_active = true) AND (au.role = 'delivery'::text)))) AND (public._uuid_or_null((o.data ->> 'assignedDeliveryUserId'::text)) = auth.uid())))))));



  create policy "orders_select_permissions"
  on "public"."orders"
  as permissive
  for select
  to public
using ((((auth.role() = 'authenticated'::text) AND (customer_auth_user_id = auth.uid())) OR ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE ((au.auth_user_id = auth.uid()) AND (au.is_active = true) AND (au.role <> 'delivery'::text)))) AND public.has_admin_permission('orders.view'::text)) OR ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE ((au.auth_user_id = auth.uid()) AND (au.is_active = true) AND (au.role = 'delivery'::text)))) AND (public._uuid_or_null((data ->> 'assignedDeliveryUserId'::text)) = auth.uid()))));


CREATE TRIGGER trg_close_import_shipment_trigger AFTER UPDATE OF status ON public.import_shipments FOR EACH ROW EXECUTE FUNCTION public.trg_close_import_shipment();

CREATE TRIGGER trg_inventory_movements_purchase_in_sync_batch_balances_del AFTER DELETE ON public.inventory_movements FOR EACH ROW WHEN ((old.movement_type = 'purchase_in'::text)) EXECUTE FUNCTION public.trg_inventory_movements_purchase_in_sync_batch_balances();

CREATE TRIGGER trg_sync_reservation_stock AFTER INSERT OR DELETE OR UPDATE ON public.reservation_lines FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_to_stock();

CREATE CONSTRAINT TRIGGER trg_orders_require_sale_out_on_delivered AFTER UPDATE OF status ON public.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_orders_require_sale_out_on_delivered();


