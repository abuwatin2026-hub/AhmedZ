-- Add deleted_at column for soft delete to preserve audit trail
ALTER TABLE public.purchase_orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
-- Fix purge function to use Soft Delete instead of DELETE
create or replace function public.purge_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_has_receipts boolean;
  v_has_payments boolean;
  v_has_movements boolean;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  -- Only Owner can purge
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

  -- Validation: Cannot purge if it has related records (receipts, payments, movements)
  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  select exists(
    select 1
    from public.payments p
    where p.reference_table = 'purchase_orders'
    and p.reference_id::text = p_order_id::text
  ) into v_has_payments;

  select exists(
    select 1
    from public.inventory_movements im
    where (im.reference_table = 'purchase_orders' and im.reference_id::text = p_order_id::text)
       or (im.data ? 'purchaseOrderId' and im.data->>'purchaseOrderId' = p_order_id::text)
  ) into v_has_movements;

  if coalesce(v_has_receipts, false) or coalesce(v_has_payments, false) or coalesce(v_has_movements, false) then
    raise exception 'cannot purge posted purchase order - void it instead';
  end if;

  -- Audit Log
  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'soft_delete',
    'purchases',
    concat('Soft deleted (purged) purchase order ', p_order_id::text),
    auth.uid(),
    now(),
    jsonb_build_object('purchaseOrderId', p_order_id::text)
  );

  -- Perform Soft Delete
  update public.purchase_orders
  set deleted_at = now(),
      updated_at = now(),
      status = 'cancelled' -- Also mark as cancelled for visual clarity
  where id = p_order_id;
end;
$$;
