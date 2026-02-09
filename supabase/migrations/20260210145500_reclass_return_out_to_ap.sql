create or replace function public.reclass_return_out_to_ap(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry uuid;
  v_done int := 0;
begin
  if not (public.has_admin_permission('accounting.manage') and public.has_admin_permission('accounting.approve')) then
    raise exception 'not allowed';
  end if;
  if p_receipt_id is null then
    raise exception 'p_receipt_id required';
  end if;

  for v_mv in
    select im.id, im.total_cost
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = p_receipt_id::text
      and im.movement_type = 'return_out'
  loop
    v_entry := public.create_manual_journal_entry(
      now(),
      concat('Reclass return_out to AP for receipt ', p_receipt_id::text),
      jsonb_build_array(
        jsonb_build_object('accountCode','2010','debit', coalesce(v_mv.total_cost,0)),
        jsonb_build_object('accountCode','5020','credit', coalesce(v_mv.total_cost,0))
      )
    );
    perform public.approve_journal_entry(v_entry);
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('reclassCount', v_done);
end;
$$;

revoke all on function public.reclass_return_out_to_ap(uuid) from public;
grant execute on function public.reclass_return_out_to_ap(uuid) to authenticated;
