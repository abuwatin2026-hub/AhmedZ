do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure
  ) into v_def;

  -- Log current returned_sales area
  raise notice E'returned_sales context:\n%',
    substring(v_def from position('returned_sales' in v_def) - 100 for 400);

  -- Restore: remove window function and restore simple formula
  -- The window formula looks like: sum(case when rigv.return_amount > 0 ... over (partition by rigv.return_id) ... end) as returned_sales
  -- We use the broadest possible pattern with non-greedy matching disabled (PostgreSQL POSIX regex doesn't support ?)
  -- Use 's' flag (dot matches newline)

  v_old := substring(v_def from 'sum\(case\s+when[^\n]*\n[^\n]*as\s+returned_sales');
  raise notice 'v_old matched: %', v_old is not null;
  
  v_new := 'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales';

  if v_old is not null then
    v_def := replace(v_def, v_old, v_new);
  end if;

  if v_def like '%sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales%' then
    execute v_def;
    raise notice 'SUCCESS: returned_sales restored';
  else
    raise exception 'Could not restore returned_sales formula';
  end if;
end;
$$;
