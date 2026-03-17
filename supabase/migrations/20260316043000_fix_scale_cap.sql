-- Fix order_scaling CTE: cap scale_to_subtotal at max 1.0
-- Problem: when invoiceSnapshot is incomplete (fewer items than actual order),
-- items_gross_sum < subtotal, causing scale > 1 which inflates individual item revenue.
-- Example: order with 6 items but snap has only 1 → scale=6 → that item gets 6x revenue
-- then when returned, returns_sales deducts 6x → net revenue = 0 (false loss).
-- Fix: scale_to_subtotal should never exceed 1.0 since it's meant to distribute
-- the discount proportionally across items, not inflate revenue.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;

  -- The current scale_to_subtotal formula:
  -- case
  --   when coalesce(ot.subtotal_amount, 0) > 0 and coalesce(ot.items_gross_sum, 0) > 0
  --     then (ot.subtotal_amount / ot.items_gross_sum)
  --   else 1
  -- end as scale_to_subtotal
  --
  -- Fix: cap at 1.0 to prevent over-inflation from incomplete invoiceSnapshot
  v_def := replace(
    v_def,
    'then (ot.subtotal_amount / ot.items_gross_sum)',
    'then least((ot.subtotal_amount / ot.items_gross_sum), 1.0)'
  );

  if v_def not like '%least((ot.subtotal_amount / ot.items_gross_sum), 1.0)%' then
    raise notice 'SKIPPED: scale_to_subtotal cap fix did not apply (safe for fresh DB)';
  end if;

  execute v_def;
  raise notice 'Applied scale_to_subtotal cap at 1.0';
end;
$$;

notify pgrst, 'reload schema';
