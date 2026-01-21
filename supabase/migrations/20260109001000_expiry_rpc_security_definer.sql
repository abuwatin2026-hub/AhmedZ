-- ترقية دالة process_expired_items لتكون Security Definer وتستخدم search_path=public
-- هذا يحسّن التوافق مع سياسات RLS ويمنع أخطاء الاستدعاء من الواجهة

create or replace function public.process_expired_items()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    processed_count integer := 0;
    expired_item record;
    v_order_id uuid;
    v_items jsonb;
    v_wastage_qty numeric;
begin
    for v_order_id in
        select distinct o.id
        from public.orders o
        where o.status not in ('delivered', 'cancelled')
          and exists (
            select 1
            from jsonb_array_elements(coalesce(o.items, o.data->'items', '[]'::jsonb)) as it
            join public.menu_items mi on mi.id = coalesce(it->>'itemId', it->>'id')
            where mi.status = 'active'
              and (
                nullif(mi.data->>'expiryDate', '') is not null
                and left(mi.data->>'expiryDate', 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                and (left(mi.data->>'expiryDate', 10)::date) < current_date
              )
          )
    loop
        begin
            perform public.cancel_order(v_order_id, 'ITEM_EXPIRED');
        exception when others then
            null;
        end;
    end loop;

    for expired_item in 
        select
            mi.id,
            mi.cost_price,
            mi.unit_type,
            sm.available_quantity
        from public.menu_items mi
        join public.stock_management sm on sm.item_id::text = mi.id
        where mi.status = 'active'
          and (
            nullif(mi.data->>'expiryDate', '') is not null
            and left(mi.data->>'expiryDate', 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            and (left(mi.data->>'expiryDate', 10)::date) < current_date
          )
          and coalesce(sm.available_quantity, 0) > 0
        for update of sm
    loop
        v_wastage_qty := greatest(coalesce(expired_item.available_quantity, 0), 0);

        insert into public.stock_wastage (
            item_id,
            quantity,
            unit_type,
            cost_at_time,
            reason,
            notes,
            reported_by,
            created_at
        )
        select
            expired_item.id,
            v_wastage_qty,
            expired_item.unit_type,
            coalesce(expired_item.cost_price, 0),
            'auto_expired',
            'Auto-processed expiry detection',
            auth.uid(),
            now()
        where v_wastage_qty > 0;

        update public.menu_items
        set status = 'archived',
            data = jsonb_set(coalesce(data, '{}'::jsonb), '{availableStock}', '0'::jsonb, true),
            updated_at = now()
        where id = expired_item.id;

        update public.stock_management
        set available_quantity = 0,
            reserved_quantity = 0,
            last_updated = now(),
            updated_at = now(),
            data = jsonb_set(
                    jsonb_set(coalesce(data, '{}'::jsonb), '{availableQuantity}', '0'::jsonb, true),
                    '{reservedQuantity}',
                    '0'::jsonb,
                    true
                  )
        where item_id = expired_item.id;

        processed_count := processed_count + 1;
    end loop;

    return json_build_object(
        'success', true, 
        'processed_count', processed_count
    );
exception when others then
    return json_build_object(
        'success', false, 
        'error', sqlerrm
    );
end;
$$;
