create or replace function public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb,
    p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order record;
    v_order_data jsonb;
    v_promos jsonb;
    v_promos_fixed jsonb := '[]'::jsonb;
    v_line jsonb;
    v_snapshot jsonb;
    v_final_data jsonb;
    v_is_cod boolean := false;
    v_driver_id uuid;
    v_delivered_at timestamptz;
    v_rows int;
    v_new_status text;
    v_stock_deducted boolean := false;
    v_items_all jsonb := '[]'::jsonb;
begin
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;

    select *
    into v_order
    from public.orders o
    where o.id = p_order_id
    for update;

    if not found then
      raise exception 'order not found';
    end if;

    -- Idempotency check: If already delivered, do nothing
    if v_order.status = 'delivered' then
       return;
    end if;

    v_order_data := coalesce(v_order.data, '{}'::jsonb);
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      p_items := '[]'::jsonb;
    end if;
    v_items_all := p_items;

    -- Check if stock already deducted (to avoid double deduction on retry or partial failure)
    select exists (
      select 1 from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = p_order_id::text
        and im.movement_type = 'sale_out'
    ) into v_stock_deducted;

    if not v_stock_deducted then
       perform public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);
    end if;

    v_final_data := coalesce(p_updated_data, v_order_data);
    
    -- Handle Promotions (Snapshotting)
    v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
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
           p_warehouse_id
        );
        v_line := jsonb_set(v_line, '{promotionSnapshot}', v_snapshot, true);
        v_promos_fixed := v_promos_fixed || v_line;
      end loop;
      
      if jsonb_array_length(v_promos_fixed) > 0 then
        v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos_fixed, true);
      end if;
    end if;

    -- Handle COD
    v_is_cod := public._is_cod_delivery_order(v_final_data, v_order.delivery_zone_id);
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

    -- Perform Update with Diagnostics
    update public.orders
    set status = 'delivered',
        data = v_final_data,
        updated_at = now()
    where id = p_order_id
    returning status into v_new_status;
    
    get diagnostics v_rows = row_count;
    
    if v_rows = 0 then
       raise exception 'Update failed: Order not found or permission denied during update (Row Count 0)';
    end if;
    
    if v_new_status <> 'delivered' then
       raise exception 'Update failed: Status did not change to delivered (Trigger interference?)';
    end if;
end;
$$;

grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;
