-- Fix returns_sales: the previous fix was too aggressive (deducted even when no refund was given).
-- Correct logic:
--   - When total_refund_amount > 0: deduct gross_value * fx_rate (proportional item value in SAR)
--   - When total_refund_amount = 0: deduct nothing (no refund was actually issued)
-- This replaces the over-aggressive fix that used sum(gross_value * fx_rate) unconditionally.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise exception 'get_product_sales_report_v9 not found';
  end if;

  -- Replace the current (over-aggressive) formula with the correct conditional one:
  v_def := regexp_replace(
    v_def,
    'sum\(rigv\.gross_value\s*\*\s*rigv\.fx_rate_effective\)\s*as\s+returned_sales',
    'sum(case when rs.return_amount > 0 then rigv.gross_value * rigv.fx_rate_effective else 0 end) as returned_sales',
    'i'
  );

  -- Verify replacement
  if v_def not like '%when rs.return_amount > 0 then rigv.gross_value * rigv.fx_rate_effective%' then
    raise exception 'replacement did not work';
  end if;

  execute v_def;
  raise notice 'Fixed returns_sales: conditional deduction based on refund amount';
end;
$$;

notify pgrst, 'reload schema';
