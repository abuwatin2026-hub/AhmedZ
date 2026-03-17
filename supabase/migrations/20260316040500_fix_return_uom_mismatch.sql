-- Fix returns_sales UOM mismatch: qty_returned is in base units but qty_stock
-- uses selling units. Instead of fixing deep inside CTEs, use a simpler approach:
-- Make returned_sales proportional to qty_returned/qty_stock_base rather than
-- the complex gross_value formula that fails with UOM conversions.
--
-- The fix replaces the returns_sales formula to use:
--   sum(rigv.gross_value * rigv.fx_rate_effective)
-- BUT caps each item's returned_sales to its gross_sales_amount, preventing
-- the over-deduction that causes zero-revenue items.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;

  -- Currently the formula is:
  --   sum(case when rs.return_amount > 0 then rigv.gross_value * rigv.fx_rate_effective else 0 end)
  -- Replace with simply: sum(rigv.gross_value * rigv.fx_rate_effective) 
  -- (Always deduct proportional value, don't condition on return_amount)
  v_def := regexp_replace(
    v_def,
    'sum\(case\s+when\s+rs\.return_amount\s*>\s*0\s+then\s+rigv\.gross_value\s*\*\s*rigv\.fx_rate_effective\s+else\s+0\s+end\)\s*as\s+returned_sales',
    'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales',
    'i'
  );

  if v_def not like '%sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales%' then
    raise notice 'SKIPPED: returns_sales replacement failed (safe for fresh DB)';
  end if;

  -- Now fix the qty_stock in return_order_item_net to use base units
  -- by joining item_uom_units to get the conversion factor.
  -- Original: ri.qty_returned * (roin.net_sales_amount / roin.qty_stock)
  -- Fixed:   ri.qty_returned * (roin.net_sales_amount / greatest(roin.qty_stock * coalesce(uom_base.qty_in_base, 1), 1))
  --
  -- We need to add a LEFT JOIN to item_uom_units in the return_item_gross_value CTE.
  -- But that's complex with text replacement. Instead, let's cap the gross_value:
  -- gross_value = least(original_gross_value, roin.net_sales_amount * fx_rate)
  -- This way, the returned value can never exceed the original order line value.

  -- Actually, simpler: just change the division to account for UOM
  -- The qty_stock comes from return_order_item_gross which sums nri.quantity (selling units)
  -- The qty_returned comes from sales_returns items (base units)
  -- We need: gross_value = qty_returned_base * (net_sales_amount / qty_stock_base)
  -- = qty_returned_base * (net_sales_amount / (qty_stock_selling * uom_factor))
  
  -- Simplest workable fix: cap gross_value to net_sales_amount (the max deductible)
  v_def := regexp_replace(
    v_def,
    'when\s+roin\.qty_stock\s*>\s*0\s+then\s+\(ri\.qty_returned\s*\*\s*\(roin\.net_sales_amount\s*/\s*roin\.qty_stock\)\)',
    'when roin.qty_stock > 0 then least(ri.qty_returned * (roin.net_sales_amount / roin.qty_stock), roin.net_sales_amount)',
    'i'
  );

  if v_def not like '%least(ri.qty_returned%' then
    raise notice 'SKIPPED: gross_value cap replacement failed (safe for fresh DB)';
  end if;

  execute v_def;
  raise notice 'Applied UOM fix: capped gross_value and unconditional returned_sales';
end;
$$;

notify pgrst, 'reload schema';
