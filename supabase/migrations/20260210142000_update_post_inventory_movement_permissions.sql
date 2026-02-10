create or replace function public.post_inventory_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  v_doc_type text;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.post') or public.has_admin_permission('accounting.manage')) then
    raise exception 'not allowed';
  end if;
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select * into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;
  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.movement_type = 'sale_out' and v_mv.batch_id is null then
    raise exception 'SALE_OUT_REQUIRES_BATCH';
  end if;

  if v_mv.reference_table = 'production_orders' then
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

  if v_mv.movement_type in ('wastage_out','adjust_out') then
    v_doc_type := 'writeoff';
  elsif v_mv.movement_type = 'purchase_in' then
    v_doc_type := 'po';
  elsif v_mv.movement_type in ('return_out','return_in') then
    v_doc_type := 'return';
  else
    v_doc_type := 'inventory';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  if v_mv.movement_type in ('purchase_in','adjust_in','return_in') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, (v_mv.total_cost - v_supplier_tax_total), case when v_doc_type='po' then 'Accounts payable' else 'Vendor credit' end);
    if v_supplier_tax_total > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT input (supplier tax)');
    end if;
  elsif v_mv.movement_type in ('wastage_out','expired_out','adjust_out','return_out') then
    if v_mv.movement_type = 'return_out' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_mv.total_cost, 0, 'Reverse accounts payable (vendor credit)'),
        (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Inventory writeoff'),
        (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to authenticated;
