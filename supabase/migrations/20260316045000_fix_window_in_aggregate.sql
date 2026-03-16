do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure
  ) into v_def;

  -- Replace the broken window-in-aggregate pattern with a pre-computed approach.
  -- The broken formula is:
  --   sum(case when rigv.return_amount > 0 and sum(rigv.gross_value) over (partition by rigv.return_id) > 0
  --     then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / nullif(sum(rigv.gross_value) over (partition by rigv.return_id), 0))
  --     else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales
  --   from return_item_gross_value rigv
  --   join return_scaling rs on rs.return_id = rigv.return_id
  --
  -- Fixed: use rs.total_gross from return_scaling CTE instead of the window function.
  -- We need to check if return_scaling CTE has a total_gross column,
  -- or use a correlated subquery.

  -- Check if return_scaling has total_gross
  if v_def like '%return_scaling%total_gross%' then
    -- Use rs.total_gross from return_scaling CTE
    v_old := 'sum(case when rigv.return_amount > 0 and sum(rigv.gross_value) over (partition by rigv.return_id) > 0 then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / nullif(sum(rigv.gross_value) over (partition by rigv.return_id), 0)) else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales';
    v_new := 'sum(case when rigv.return_amount > 0 and rs.total_gross > 0 then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / rs.total_gross) else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales';
    raise notice 'Using rs.total_gross from return_scaling';
  else
    -- return_scaling doesn't have total_gross — restore simple formula
    v_old := 'sum(case when rigv.return_amount > 0 and sum(rigv.gross_value) over (partition by rigv.return_id) > 0 then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / nullif(sum(rigv.gross_value) over (partition by rigv.return_id), 0)) else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales';
    v_new := 'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales';
    raise notice 'return_scaling has no total_gross — using simple formula';
  end if;

  -- Show return_scaling CTE for debugging
  raise notice 'return_scaling context: %', substring(v_def from position('return_scaling' in v_def) for 300);

  v_def := replace(v_def, v_old, v_new);

  if v_def not like '%as returned_sales%' then
    raise exception 'replacement failed — old text not found in function body';
  end if;

  execute v_def;
  raise notice 'Applied returned_sales fix successfully';
end;
$$;

notify pgrst, 'reload schema';
