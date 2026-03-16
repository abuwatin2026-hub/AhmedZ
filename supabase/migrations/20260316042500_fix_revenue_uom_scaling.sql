-- Fix revenue-quantity UOM mismatch v2:
-- Previous fix scaled (gross - returned) × UOM factor which was inaccurate
-- because returned_sales was already inflated.
-- New fix: compute net_sales as net_qty × revenue_per_selling_unit
-- Formula: (net_base_qty) × (gross_revenue / order_qty)
-- For tuna: 48 × (7.68 / 3) = 48 × 2.56 = 122.88

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;

  -- The current pattern (from the first scaling fix that was applied but repair'd):
  -- greatest(
  --     (coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0))
  --     * case
  --         when coalesce(sl.qty_sold, 0) > 0 and coalesce(cg.gross_qty, 0) > 0
  --         then cg.gross_qty / sl.qty_sold
  --         else 1
  --       end,
  --     0
  --   ) as net_sales_raw

  -- Match the current pattern using regexp
  v_def := regexp_replace(
    v_def,
    'greatest\s*\(\s*\(\s*coalesce\s*\(\s*sl\.net_sales.*?end\s*,\s*0\s*\)\s+as\s+net_sales_raw',
    'greatest(
        case
          when coalesce(sl.qty_sold, 0) > 0 and coalesce(cg.gross_qty, 0) > 0
          then greatest(coalesce(cg.gross_qty, sl.qty_sold, 0) - coalesce(rc.qty_returned_cost, rs.qty_returned, 0), 0)
               * (coalesce(sl.net_sales, 0) / nullif(sl.qty_sold, 0))
          else greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0)
        end,
        0
      ) as net_sales_raw',
    'is'
  );

  if v_def not like '%sl.net_sales, 0) / nullif(sl.qty_sold%' then
    raise exception 'net_sales_raw fix did not apply';
  end if;

  execute v_def;
  raise notice 'Applied net_qty × price_per_unit formula v2';
end;
$$;

notify pgrst, 'reload schema';
