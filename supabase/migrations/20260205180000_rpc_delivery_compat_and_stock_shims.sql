do $$
begin
  if to_regprocedure('public.deduct_stock_on_delivery_v2(uuid,uuid)') is null then
    create function public.deduct_stock_on_delivery_v2(p_order_id uuid, p_warehouse_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_order_data jsonb;
      v_items jsonb;
    begin
      select o.data into v_order_data
      from public.orders o
      where o.id = p_order_id;
      v_items := coalesce(v_order_data->'items', '[]'::jsonb);
      if v_items is null or jsonb_typeof(v_items) <> 'array' then
        v_items := '[]'::jsonb;
      end if;
      if to_regprocedure('public.deduct_stock_on_delivery_v2(uuid,jsonb,uuid)') is not null then
        perform public.deduct_stock_on_delivery_v2(p_order_id, v_items, p_warehouse_id);
        return;
      end if;
      if to_regprocedure('public.deduct_stock_on_delivery_v2(uuid,jsonb)') is not null then
        perform public.deduct_stock_on_delivery_v2(p_order_id, v_items);
        return;
      end if;
      raise exception 'deduct_stock_on_delivery_v2 missing';
    end;
    $fn$;
  end if;

  if to_regprocedure('public.deduct_stock_on_delivery_v2(jsonb,uuid,uuid)') is null then
    create function public.deduct_stock_on_delivery_v2(p_items jsonb, p_order_id uuid, p_warehouse_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if to_regprocedure('public.deduct_stock_on_delivery_v2(uuid,jsonb,uuid)') is not null then
        perform public.deduct_stock_on_delivery_v2(p_order_id, p_items, p_warehouse_id);
        return;
      end if;
      if to_regprocedure('public.deduct_stock_on_delivery_v2(uuid,jsonb)') is not null then
        perform public.deduct_stock_on_delivery_v2(p_order_id, p_items);
        return;
      end if;
      raise exception 'deduct_stock_on_delivery_v2 missing';
    end;
    $fn$;
  end if;

  revoke all on function public.deduct_stock_on_delivery_v2(uuid, uuid) from public;
  revoke execute on function public.deduct_stock_on_delivery_v2(uuid, uuid) from anon;
  grant execute on function public.deduct_stock_on_delivery_v2(uuid, uuid) to authenticated;

  revoke all on function public.deduct_stock_on_delivery_v2(jsonb, uuid, uuid) from public;
  revoke execute on function public.deduct_stock_on_delivery_v2(jsonb, uuid, uuid) from anon;
  grant execute on function public.deduct_stock_on_delivery_v2(jsonb, uuid, uuid) to authenticated;

  if to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb,uuid)') is null
     and to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb)') is not null then
    create function public.confirm_order_delivery(
      p_order_id uuid,
      p_items jsonb,
      p_updated_data jsonb,
      p_warehouse_id uuid
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_status text;
      v_data jsonb;
      v_updated_at timestamptz;
    begin
      perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data);
      select o.status::text, o.data, o.updated_at into v_status, v_data, v_updated_at
      from public.orders o
      where o.id = p_order_id;
      return jsonb_build_object(
        'orderId', p_order_id::text,
        'status', coalesce(v_status, 'delivered'),
        'data', coalesce(v_data, '{}'::jsonb),
        'updatedAt', coalesce(v_updated_at, now())
      );
    end;
    $fn$;

    revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from public;
    revoke execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from anon;
    grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;
  end if;

  if to_regprocedure('public.confirm_order_delivery(jsonb)') is null
     and (to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb,uuid)') is not null
          or to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb)') is not null) then
    create function public.confirm_order_delivery(p_payload jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_items jsonb;
      v_updated_data jsonb;
      v_order_id uuid;
      v_warehouse_id uuid;
      v_order_id_text text;
      v_warehouse_id_text text;
    begin
      if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be a json object';
      end if;
      v_items := p_payload->'p_items';
      v_updated_data := p_payload->'p_updated_data';
      v_order_id_text := nullif(btrim(coalesce(p_payload->>'p_order_id','')), '');
      v_warehouse_id_text := nullif(btrim(coalesce(p_payload->>'p_warehouse_id','')), '');
      if v_order_id_text is null then
        raise exception 'p_order_id is required';
      end if;
      v_order_id := v_order_id_text::uuid;
      if v_warehouse_id_text is not null then
        v_warehouse_id := v_warehouse_id_text::uuid;
      end if;
      if v_items is null or jsonb_typeof(v_items) <> 'array' then
        v_items := '[]'::jsonb;
      end if;
      if to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb,uuid)') is not null and v_warehouse_id is not null then
        return public.confirm_order_delivery(v_order_id, v_items, v_updated_data, v_warehouse_id);
      end if;
      if to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb)') is not null then
        perform public.confirm_order_delivery(v_order_id, v_items, v_updated_data);
        return jsonb_build_object('orderId', v_order_id::text, 'status', 'delivered');
      end if;
      raise exception 'confirm_order_delivery missing';
    end;
    $fn$;

    revoke all on function public.confirm_order_delivery(jsonb) from public;
    revoke execute on function public.confirm_order_delivery(jsonb) from anon;
    grant execute on function public.confirm_order_delivery(jsonb) to authenticated;
  end if;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
