set app.allow_ledger_ddl = '1';

create or replace function public.trg_close_import_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_im record;
  v_batch record;
  v_out record;
  v_qty_linked numeric;
  v_new_unit numeric;
  v_close_at timestamptz;
  v_total_delta_sold numeric := 0;
  v_total_delta_rem numeric := 0;
  v_delta numeric;
  v_entry_id uuid;
  v_accounts jsonb;
  v_inventory uuid;
  v_cogs uuid;
  v_clearing uuid;
  v_branch uuid;
  v_company uuid;
  v_order_id uuid;
  v_total_delta numeric;
  v_sm_avg numeric;
  v_rem_qty numeric;
begin
  if coalesce(new.status, '') <> 'closed' then
    return new;
  end if;
  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;
  if new.destination_warehouse_id is null then
    raise exception 'destination_warehouse_id is required to close import shipment %', new.id;
  end if;
  if not exists (select 1 from public.purchase_receipts pr where pr.import_shipment_id = new.id) then
    raise exception 'No linked purchase receipts for import shipment %', new.id;
  end if;

  v_close_at := coalesce(new.actual_arrival_date::timestamptz, now());
  perform public.calculate_shipment_landed_cost(new.id);

  for v_row in
    select
      isi.item_id::text as item_id_text,
      coalesce(isi.quantity, 0) as expected_qty
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
    select coalesce(sum(pri.quantity), 0)
    into v_qty_linked
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.import_shipment_id = new.id
      and coalesce(pr.warehouse_id, new.destination_warehouse_id) = new.destination_warehouse_id
      and pri.item_id::text = v_row.item_id_text;

    if abs(coalesce(v_qty_linked, 0) - coalesce(v_row.expected_qty, 0)) > 1e-6 then
      raise exception 'Linked receipt quantity mismatch for item % (expected %, got %)', v_row.item_id_text, v_row.expected_qty, v_qty_linked;
    end if;
  end loop;

  for v_row in
    select
      pr.id as receipt_id,
      pri.id as receipt_item_id,
      pri.item_id::text as item_id_text,
      coalesce(pri.quantity, 0) as qty,
      coalesce(pri.transport_cost, 0) as transport_unit,
      coalesce(pri.supply_tax_cost, 0) as tax_unit,
      coalesce(isi.landing_cost_per_unit, 0) as landed_unit
    from public.purchase_receipts pr
    join public.purchase_receipt_items pri on pri.receipt_id = pr.id
    join public.import_shipments_items isi
      on isi.shipment_id = new.id and isi.item_id::text = pri.item_id::text
    where pr.import_shipment_id = new.id
      and coalesce(pr.warehouse_id, new.destination_warehouse_id) = new.destination_warehouse_id
  loop
    v_new_unit := coalesce(v_row.landed_unit, 0) + coalesce(v_row.transport_unit, 0) + coalesce(v_row.tax_unit, 0);

    select im.*
    into v_im
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = v_row.receipt_id::text
      and im.item_id::text = v_row.item_id_text
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1
    for update;

    if not found then
      raise exception 'Missing purchase_in movement for receipt % item %', v_row.receipt_id, v_row.item_id_text;
    end if;

    if abs(coalesce(v_im.quantity, 0) - coalesce(v_row.qty, 0)) > 1e-6 then
      raise exception 'Receipt movement quantity mismatch for receipt % item % (receipt %, movement %)',
        v_row.receipt_id, v_row.item_id_text, v_row.qty, v_im.quantity;
    end if;

    select b.* into v_batch
    from public.batches b
    where b.id = v_im.batch_id
    for update;

    if not found then
      raise exception 'Batch not found for movement %', v_im.id;
    end if;

    for v_out in
      select im2.*
      from public.inventory_movements im2
      where im2.batch_id = v_im.batch_id
        and im2.movement_type in ('sale_out','wastage_out','expired_out')
        and im2.occurred_at < v_close_at
      for update
    loop
      v_delta := (v_new_unit - coalesce(v_out.unit_cost, 0)) * coalesce(v_out.quantity, 0);
      v_total_delta_sold := v_total_delta_sold + v_delta;

      if v_out.reference_table = 'orders' then
        begin
          v_order_id := nullif(v_out.reference_id, '')::uuid;
        exception when others then
          v_order_id := null;
        end;

        if v_order_id is not null and to_regclass('public.order_item_cogs') is not null then
          update public.order_item_cogs
          set total_cost = coalesce(total_cost, 0) + v_delta,
              unit_cost = case
                when coalesce(quantity, 0) > 0 then (coalesce(total_cost, 0) + v_delta) / quantity
                else unit_cost
              end
          where order_id = v_order_id
            and item_id::text = v_row.item_id_text;
        end if;
      end if;
    end loop;

    v_rem_qty := greatest(coalesce(v_batch.quantity_received, 0) - coalesce(v_batch.quantity_consumed, 0), 0);
    v_total_delta_rem := v_total_delta_rem + ((v_new_unit - coalesce(v_im.unit_cost, 0)) * v_rem_qty);

    update public.purchase_receipt_items
    set unit_cost = v_new_unit,
        total_cost = coalesce(v_row.qty, 0) * v_new_unit
    where id = v_row.receipt_item_id;

    update public.batches
    set unit_cost = v_new_unit,
        updated_at = now()
    where id = v_batch.id;
  end loop;

  for v_row in
    select distinct pri.item_id::text as item_id_text
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.import_shipment_id = new.id
      and coalesce(pr.warehouse_id, new.destination_warehouse_id) = new.destination_warehouse_id
  loop
    select
      case when sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0)) > 0 then
        sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) * coalesce(b.unit_cost,0))
        / sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0))
      else 0 end
    into v_sm_avg
    from public.batches b
    where b.item_id::text = v_row.item_id_text
      and b.warehouse_id = new.destination_warehouse_id;

    update public.stock_management
    set avg_cost = coalesce(v_sm_avg, 0),
        updated_at = now(),
        last_updated = now()
    where item_id::text = v_row.item_id_text
      and warehouse_id = new.destination_warehouse_id;
  end loop;

  v_total_delta := coalesce(v_total_delta_sold, 0) + coalesce(v_total_delta_rem, 0);
  if abs(coalesce(v_total_delta, 0)) > 1e-6 then
    if abs(coalesce(v_total_delta_sold, 0)) > 1e-6 and not exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'import_shipments'
        and je.source_id = new.id::text
        and je.source_event = 'landed_cost_cogs_adjust'
    ) then
      select s.data->'settings'->'accounting_accounts'
      into v_accounts
      from public.app_settings s
      where s.id = 'app';

      if v_accounts is null then
        select s.data->'accounting_accounts'
        into v_accounts
        from public.app_settings s
        where s.id = 'singleton';
      end if;

      v_inventory := null;
      if v_accounts is not null and nullif(v_accounts->>'inventory', '') is not null then
        begin
          v_inventory := (v_accounts->>'inventory')::uuid;
        exception when others then
          v_inventory := public.get_account_id_by_code(v_accounts->>'inventory');
        end;
      end if;
      v_inventory := coalesce(v_inventory, public.get_account_id_by_code('1410'));

      v_cogs := null;
      if v_accounts is not null and nullif(v_accounts->>'cogs', '') is not null then
        begin
          v_cogs := (v_accounts->>'cogs')::uuid;
        exception when others then
          v_cogs := public.get_account_id_by_code(v_accounts->>'cogs');
        end;
      end if;
      v_cogs := coalesce(v_cogs, public.get_account_id_by_code('5010'));

      if v_inventory is null or v_cogs is null then
        raise exception 'Missing accounting accounts for landed cost COGS adjust (inventory %, cogs %)',
          coalesce(v_accounts->>'inventory','1410'),
          coalesce(v_accounts->>'cogs','5010');
      end if;

      v_branch := coalesce(public.branch_from_warehouse(new.destination_warehouse_id), public.get_default_branch_id());
      v_company := coalesce(public.company_from_branch(v_branch), public.get_default_company_id());

      insert into public.journal_entries(
        id, source_table, source_id, source_event, entry_date, memo, created_by, branch_id, company_id
      )
      values (
        gen_random_uuid(),
        'import_shipments',
        new.id::text,
        'landed_cost_cogs_adjust',
        v_close_at,
        concat('Import landed cost COGS adjust ', coalesce(new.reference_number, new.id::text)),
        new.created_by,
        v_branch,
        v_company
      )
      returning id into v_entry_id;

      if v_total_delta_sold > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values
          (v_entry_id, v_cogs, v_total_delta_sold, 0, 'COGS increase from landed cost'),
          (v_entry_id, v_inventory, 0, v_total_delta_sold, 'Inventory reduction (sold already)');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values
          (v_entry_id, v_inventory, -v_total_delta_sold, 0, 'Inventory increase (sold already)'),
          (v_entry_id, v_cogs, 0, -v_total_delta_sold, 'COGS decrease from landed cost');
      end if;

      perform public.check_journal_entry_balance(v_entry_id);
    end if;

    if abs(coalesce(v_total_delta_rem, 0)) > 1e-6 and not exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'import_shipments'
        and je.source_id = new.id::text
        and je.source_event = 'landed_cost_close'
    ) then
      select s.data->'settings'->'accounting_accounts'
      into v_accounts
      from public.app_settings s
      where s.id = 'app';

      if v_accounts is null then
        select s.data->'accounting_accounts'
        into v_accounts
        from public.app_settings s
        where s.id = 'singleton';
      end if;

      v_inventory := null;
      if v_accounts is not null and nullif(v_accounts->>'inventory', '') is not null then
        begin
          v_inventory := (v_accounts->>'inventory')::uuid;
        exception when others then
          v_inventory := public.get_account_id_by_code(v_accounts->>'inventory');
        end;
      end if;
      v_inventory := coalesce(v_inventory, public.get_account_id_by_code('1410'));

      v_clearing := null;
      if v_accounts is not null and nullif(v_accounts->>'landed_cost_clearing', '') is not null then
        begin
          v_clearing := (v_accounts->>'landed_cost_clearing')::uuid;
        exception when others then
          v_clearing := public.get_account_id_by_code(v_accounts->>'landed_cost_clearing');
        end;
      end if;
      v_clearing := coalesce(v_clearing, public.get_account_id_by_code('2060'));

      if v_inventory is null or v_clearing is null then
        raise exception 'Missing accounting accounts for landed cost close (inventory %, clearing %)',
          coalesce(v_accounts->>'inventory','1410'),
          coalesce(v_accounts->>'landed_cost_clearing','2060');
      end if;

      v_branch := coalesce(public.branch_from_warehouse(new.destination_warehouse_id), public.get_default_branch_id());
      v_company := coalesce(public.company_from_branch(v_branch), public.get_default_company_id());

      insert into public.journal_entries(
        id, source_table, source_id, source_event, entry_date, memo, created_by, branch_id, company_id
      )
      values (
        gen_random_uuid(),
        'import_shipments',
        new.id::text,
        'landed_cost_close',
        v_close_at,
        concat('Import landed cost close ', coalesce(new.reference_number, new.id::text)),
        new.created_by,
        v_branch,
        v_company
      )
      returning id into v_entry_id;

      if v_total_delta_rem > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values
          (v_entry_id, v_inventory, v_total_delta_rem, 0, 'Landed cost added to remaining inventory'),
          (v_entry_id, v_clearing, 0, v_total_delta_rem, 'Landed cost clearing');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values
          (v_entry_id, v_clearing, -v_total_delta_rem, 0, 'Landed cost clearing'),
          (v_entry_id, v_inventory, 0, -v_total_delta_rem, 'Landed cost removed from remaining inventory');
      end if;

      perform public.check_journal_entry_balance(v_entry_id);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_close_import_shipment() from public;
revoke execute on function public.trg_close_import_shipment() from anon;
revoke execute on function public.trg_close_import_shipment() from authenticated;
grant execute on function public.trg_close_import_shipment() to service_role;

notify pgrst, 'reload schema';

