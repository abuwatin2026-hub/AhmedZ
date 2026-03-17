-- Fix product report v9: use COGS quantity (base units) instead of order JSON quantity (selling units)
-- Root cause: quantity_sold was from order JSON items[].quantity (could be cartons, bags, etc.)
-- but total_cost was from order_item_cogs (always in base units).
-- This causes false losses when selling unit ≠ base unit (e.g., eggs: carton vs طبق).

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise notice 'SKIPPED: get_product_sales_report_v9 not found (safe for fresh DB)';
  end if;

  -- 1. Add gross_qty to cogs_gross CTE (sum COGS quantity in base units)
  v_def := replace(
    v_def,
    'sum(oic.total_cost) as gross_cost',
    'sum(oic.total_cost) as gross_cost,
      sum(oic.quantity) as gross_qty'
  );

  -- 2. In net_metrics, prefer COGS-based quantity over order JSON quantity
  v_def := replace(
    v_def,
    'coalesce(sl.qty_sold, 0) as gross_qty_sold',
    'coalesce(cg.gross_qty, sl.qty_sold, 0) as gross_qty_sold'
  );

  -- 3. Fix net_qty to use COGS-based quantities for consistent base-unit calculation
  v_def := replace(
    v_def,
    'greatest(coalesce(sl.qty_sold, 0) - coalesce(rs.qty_returned, 0), 0) as net_qty',
    'greatest(coalesce(cg.gross_qty, sl.qty_sold, 0) - coalesce(rc.qty_returned_cost, rs.qty_returned, 0), 0) as net_qty'
  );

  execute v_def;
end;
$$;

notify pgrst, 'reload schema';
