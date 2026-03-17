-- Fix net_sales_raw formula: only apply UOM scaling when COGS qty/order qty ratio > 1.1
-- For items with ratio=1 (no UOM conversion), keep original formula to avoid disrupting
-- the existing (pre-existing) behavior for those items.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;

  -- Replace current formula with one that:
  -- 1. When UOM ratio >= 2 (COGS qty is at least 2x order qty): use net_qty × price_per_selling_unit
  -- 2. When UOM ratio ≈ 1 (no conversion): use original (gross - returned) formula
  v_def := regexp_replace(
    v_def,
    'greatest\s*\(\s*case\s+when\s+coalesce\(sl\.qty_sold.*?end\s*,\s*0\s*\)\s+as\s+net_sales_raw',
    'greatest(
        case
          -- UOM conversion exists: scale revenue to match base-unit quantity
          when coalesce(sl.qty_sold, 0) > 0
            and coalesce(cg.gross_qty, 0) > 0
            and (cg.gross_qty / coalesce(sl.qty_sold, 1)) >= 1.9
          then greatest(coalesce(cg.gross_qty, sl.qty_sold, 0) - coalesce(rc.qty_returned_cost, rs.qty_returned, 0), 0)
               * (coalesce(sl.net_sales, 0) / nullif(sl.qty_sold, 0))
          -- No UOM conversion: use original returned_sales formula
          else greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0)
        end,
        0
      ) as net_sales_raw',
    'is'
  );

  if v_def not like '%cg.gross_qty / coalesce(sl.qty_sold%' then
    raise notice 'net_sales_raw conditional UOM fix did not apply — skipping (will be overwritten by later migration)';
  else
    execute v_def;
    raise notice 'Applied conditional UOM revenue scaling (ratio >= 1.9)';
  end if;
end;
$$;

notify pgrst, 'reload schema';
