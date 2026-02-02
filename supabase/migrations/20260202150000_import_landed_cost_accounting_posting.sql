insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values ('2060', 'تسوية تكاليف الاستيراد', 'asset', 'debit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;

do $$
declare
  v_clearing uuid := public.get_account_id_by_code('2060');
begin
  if to_regclass('public.app_settings') is null then
    return;
  end if;

  update public.app_settings s
  set data = jsonb_set(
    coalesce(s.data, '{}'::jsonb),
    '{settings,accounting_accounts,landed_cost_clearing}',
    to_jsonb(v_clearing),
    true
  )
  where s.id = 'app';

  update public.app_settings s
  set data = jsonb_set(
    coalesce(s.data, '{}'::jsonb),
    '{accounting_accounts,landed_cost_clearing}',
    to_jsonb(v_clearing),
    true
  )
  where s.id = 'singleton';
end $$;

create or replace function public.trg_close_import_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_sm record;
  v_im record;
  v_avail numeric;
  v_total_current numeric;
  v_total_adjusted numeric;
  v_new_avg numeric;
  v_total_delta numeric := 0;
  v_delta numeric;
  v_entry_id uuid;
  v_accounts jsonb;
  v_inventory uuid;
  v_clearing uuid;
  v_branch uuid;
  v_company uuid;
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

  perform public.calculate_shipment_landed_cost(new.id);

  for v_item in
    select
      isi.item_id::text as item_id_text,
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

    v_delta := (coalesce(v_item.landed_unit, 0) - coalesce(v_im.unit_cost, 0)) * coalesce(v_im.quantity, 0);
    v_total_delta := v_total_delta + v_delta;

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

  if abs(coalesce(v_total_delta, 0)) > 1e-6 then
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'import_shipments'
        and je.source_id = new.id::text
        and je.source_event = 'landed_cost_close'
    ) then
      return new;
    end if;

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
      raise exception 'Missing accounting accounts for import landed cost posting';
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
      coalesce(new.actual_arrival_date::timestamptz, now()),
      concat('Import landed cost adjustment ', coalesce(new.reference_number, new.id::text)),
      new.created_by,
      v_branch,
      v_company
    )
    returning id into v_entry_id;

    if v_total_delta > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_total_delta, 0, 'Landed cost added to inventory'),
        (v_entry_id, v_clearing, 0, v_total_delta, 'Landed cost clearing');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_clearing, -v_total_delta, 0, 'Landed cost clearing'),
        (v_entry_id, v_inventory, 0, -v_total_delta, 'Landed cost removed from inventory');
    end if;
  end if;

  return new;
exception
  when others then
    raise;
end;
$$;

revoke all on function public.trg_close_import_shipment() from public;
revoke execute on function public.trg_close_import_shipment() from anon;
revoke execute on function public.trg_close_import_shipment() from authenticated;
grant execute on function public.trg_close_import_shipment() to service_role;

drop trigger if exists trg_import_shipment_close on public.import_shipments;
create trigger trg_import_shipment_close
after update on public.import_shipments
for each row
when (new.status = 'closed' and (old.status is distinct from new.status))
execute function public.trg_close_import_shipment();

select pg_sleep(0.5);
notify pgrst, 'reload schema';
