-- Fix product report v9: returns_sales uses total_refund_amount to scale returned revenue,
-- but for YER orders, total_refund_amount is often 0 or a tiny YER value,
-- causing near-zero deduction from gross sales → inflated net revenue.
--
-- Fix: use the proportional item value (gross_value * fx_rate) directly,
-- instead of scaling by total_refund_amount which is unreliable for foreign currencies.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise notice 'SKIPPED: get_product_sales_report_v9 not found (safe for fresh DB)';
  end if;

  -- Replace the returns_sales CTE calculation:
  -- OLD: gross_value * (return_amount / gross_value_sum) * fx_rate
  -- This fails when return_amount is 0 or a tiny YER number.
  --
  -- NEW: gross_value * fx_rate  (directly use proportional item value in base currency)
  -- This gives the correct base-currency value of returned items.

  v_def := replace(
    v_def,
    'sum(
        case
          when rs.gross_value_sum > 0
            then rigv.gross_value * (rs.return_amount / rs.gross_value_sum) * rs.fx_rate_effective
          else 0
        end
      ) as returned_sales',
    'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales'
  );

  execute v_def;
end;
$$;

notify pgrst, 'reload schema';
