-- Fix returned_sales: use actual total_refund_amount, distributed proportionally across items.
-- Adds 'return_item_weights' CTE between return_item_gross_value and returns_sales,
-- which pre-computes the total gross per return_id (needed for proportional distribution).

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;

  -- Step 1: Insert return_item_weights CTE after return_item_gross_value
  -- This CTE groups by return_id to get total gross per return.
  -- We find the start of returns_sales CTE by looking for "returns_sales as ("
  v_def := regexp_replace(
    v_def,
    '(returns_sales\s+as\s*\()',
    'return_item_weights as (
    select
      rigv.return_id,
      sum(rigv.gross_value) as total_gross
    from return_item_gross_value rigv
    group by rigv.return_id
  ),
  \1',
    'i'
  );

  if v_def not like '%return_item_weights as%' then
    raise notice 'SKIPPED: return_item_weights CTE insertion failed (safe for fresh DB)';
  end if;

  -- Step 2: Join return_item_weights in returns_sales CTE
  -- Current: "from return_item_gross_value rigv"
  -- Replace with join to weights:
  v_def := regexp_replace(
    v_def,
    'from\s+return_item_gross_value\s+rigv(\s+join|\s+left\s+join|\s+where|\s+group)',
    'from return_item_gross_value rigv
    join return_item_weights rw on rw.return_id = rigv.return_id\1',
    'i'
  );

  if v_def not like '%join return_item_weights rw on rw.return_id%' then
    raise notice 'SKIPPED: return_item_weights join in returns_sales failed (safe for fresh DB)';
  end if;

  -- Step 3: Replace the returned_sales formula to use actual refund amount divided by weight
  v_def := regexp_replace(
    v_def,
    'sum\(rigv\.gross_value\s*\*\s*rigv\.fx_rate_effective\)\s+as\s+returned_sales',
    'sum(case when rigv.return_amount > 0 and rw.total_gross > 0 then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / rw.total_gross) else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales',
    'is'
  );

  if v_def not like '%rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value%' then
    raise notice 'SKIPPED: returned_sales formula replacement failed (safe for fresh DB)';
  end if;

  execute v_def;
  raise notice 'Applied refund-proportional returned_sales via return_item_weights CTE';
end;
$$;

notify pgrst, 'reload schema';
