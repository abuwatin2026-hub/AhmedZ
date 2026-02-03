create or replace function public.allocate_landed_cost_to_inventory(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.allocate_landed_cost_to_inventory(uuid) from public;
grant execute on function public.allocate_landed_cost_to_inventory(uuid) to service_role, authenticated;

notify pgrst, 'reload schema';
