-- Upsert Inventory Shrinkage account (5020)
insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values ('5020', 'Inventory Shrinkage', 'expense', 'debit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;
-- Extend inventory posting to handle wastage/adjustments
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
begin
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

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');

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

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Wastage'),
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
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
-- Post cash shift close with cash over/short adjustment
create or replace function public.post_cash_shift_close(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.post_cash_shift_close(uuid) from public;
grant execute on function public.post_cash_shift_close(uuid) to anon, authenticated;
