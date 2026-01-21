create or replace function public.purge_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_receipt_ids uuid[];
  v_payment_ids uuid[];
  v_movement_ids uuid[];
  v_mv record;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select exists(
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role = 'owner'
  ) into v_is_owner;

  if not coalesce(v_is_owner, false) then
    raise exception 'not allowed';
  end if;

  select coalesce(array_agg(pr.id), '{}'::uuid[])
  into v_receipt_ids
  from public.purchase_receipts pr
  where pr.purchase_order_id = p_order_id;

  select coalesce(array_agg(p.id), '{}'::uuid[])
  into v_payment_ids
  from public.payments p
  where p.reference_table = 'purchase_orders'
    and p.reference_id = p_order_id::text;

  select coalesce(array_agg(im.id), '{}'::uuid[])
  into v_movement_ids
  from public.inventory_movements im
  where (im.reference_table = 'purchase_orders' and im.reference_id = p_order_id::text)
     or (im.reference_table = 'purchase_receipts' and im.reference_id in (select unnest(v_receipt_ids)::text))
     or (im.data ? 'purchaseOrderId' and im.data->>'purchaseOrderId' = p_order_id::text);

  for v_mv in
    select im.item_id, im.movement_type, im.quantity
    from public.inventory_movements im
    where im.id = any(v_movement_ids)
  loop
    if v_mv.movement_type = 'purchase_in' then
      update public.stock_management
      set available_quantity = greatest(0, available_quantity - v_mv.quantity),
          last_updated = now(),
          updated_at = now()
      where item_id = v_mv.item_id;
    elsif v_mv.movement_type = 'return_out' then
      update public.stock_management
      set available_quantity = available_quantity + v_mv.quantity,
          last_updated = now(),
          updated_at = now()
      where item_id = v_mv.item_id;
    end if;
  end loop;

  delete from public.journal_entries je
  where je.source_table = 'payments'
    and je.source_id in (
      select p.id::text
      from public.payments p
      where p.id = any(v_payment_ids)
    );

  delete from public.journal_entries je
  where je.source_table = 'inventory_movements'
    and je.source_id in (
      select im.id::text
      from public.inventory_movements im
      where im.id = any(v_movement_ids)
    );

  delete from public.payments p
  where p.id = any(v_payment_ids);

  delete from public.inventory_movements im
  where im.id = any(v_movement_ids);

  delete from public.purchase_orders po
  where po.id = p_order_id;
end;
$$;
revoke all on function public.purge_purchase_order(uuid) from public;
grant execute on function public.purge_purchase_order(uuid) to anon, authenticated;
