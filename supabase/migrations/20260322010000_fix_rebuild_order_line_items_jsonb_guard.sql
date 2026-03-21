-- ============================================================
-- Migration: Fix rebuild_order_line_items - jsonb_typeof guard
-- Date: 2026-03-22
--
-- Root cause of 22023 error in process_sales_return:
--   rebuild_order_line_items called jsonb_array_elements on
--   coalesce(v_order.items, v_order.data->'items', '[]')
--   When data->'items' is a JSONB object (not array), this
--   crashes with: "cannot extract elements from an object"
--
-- Fix: Add jsonb_typeof guard before jsonb_array_elements
-- ============================================================

CREATE OR REPLACE FUNCTION public.rebuild_order_line_items(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
  v_items_src jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  delete from public.order_line_items where order_id = p_order_id;

  -- FIX: Guard jsonb_array_elements — coalesce may return an OBJECT if data->'items'
  -- is not an array (e.g. a single item stored as object, or nested structure).
  -- Previously: jsonb_array_elements(coalesce(v_order.items, v_order.data->'items', '[]'))
  -- This caused error 22023 "cannot extract elements from an object" when data->'items'
  -- was a JSONB object, triggering the crash in recompute_order_return_status → rebuild_order_line_items
  v_items_src := coalesce(v_order.items, v_order.data->'items', '[]'::jsonb);

  -- Normalize to array regardless of source type
  if jsonb_typeof(v_items_src) = 'object' then
    v_items_src := jsonb_build_array(v_items_src);
  elsif jsonb_typeof(v_items_src) is null or jsonb_typeof(v_items_src) <> 'array' then
    v_items_src := '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(v_items_src)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'price')::numeric, 0);
    insert into public.order_line_items(order_id, item_id, quantity, unit_price, total, data)
    values (p_order_id, v_item_id, v_qty, v_price, v_qty * v_price, v_item);
  end loop;
end;
$function$;
