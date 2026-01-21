-- Cash Flow Statement Function
-- Calculates cash flows from operating, investing, and financing activities

CREATE OR REPLACE FUNCTION public.can_view_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role in ('owner','manager')
        or ('reports.view' = any(coalesce(au.permissions, '{}'::text[])))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_reports() FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_reports() TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.cash_flow_statement(p_start date, p_end date)
RETURNS TABLE(
  operating_activities numeric,
  investing_activities numeric,
  financing_activities numeric,
  net_cash_flow numeric,
  opening_cash numeric,
  closing_cash numeric
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cash_accounts AS (
    -- Cash and Bank accounts
    SELECT id FROM public.chart_of_accounts 
    WHERE code IN ('1010', '1020') AND is_active = true
  ),
  opening AS (
    -- Opening cash balance (before start date)
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as opening_balance
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id IN (SELECT id FROM cash_accounts)
      AND p_start IS NOT NULL
      AND je.entry_date::date < p_start
      AND public.can_view_reports()
  ),
  operating AS (
    -- Operating activities: Cash from sales, payments, expenses
    SELECT COALESCE(SUM(
      CASE 
        WHEN coa.code IN ('1010', '1020') THEN (jl.debit - jl.credit)
        ELSE 0 
      END
    ), 0) as operating_cash
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
    WHERE public.can_view_reports()
      AND (p_start IS NULL OR je.entry_date::date >= p_start)
      AND (p_end IS NULL OR je.entry_date::date <= p_end)
      AND je.source_table IN ('orders', 'payments', 'expenses', 'sales_returns', 'cash_shifts')
  ),
  investing AS (
    -- Investing activities: Currently none, but placeholder for future
    -- (e.g., purchase of equipment, sale of assets)
    SELECT 0::numeric as investing_cash
  ),
  financing AS (
    -- Financing activities: Currently none, but placeholder for future
    -- (e.g., loans, owner contributions, dividends)
    SELECT 0::numeric as financing_cash
  ),
  closing AS (
    -- Closing cash balance (up to end date)
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as closing_balance
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id IN (SELECT id FROM cash_accounts)
      AND (p_end IS NULL OR je.entry_date::date <= p_end)
      AND public.can_view_reports()
  )
  SELECT
    (SELECT operating_cash FROM operating) as operating_activities,
    (SELECT investing_cash FROM investing) as investing_activities,
    (SELECT financing_cash FROM financing) as financing_activities,
    (SELECT operating_cash FROM operating) + 
    (SELECT investing_cash FROM investing) + 
    (SELECT financing_cash FROM financing) as net_cash_flow,
    (SELECT opening_balance FROM opening) as opening_cash,
    (SELECT closing_balance FROM closing) as closing_cash;
$$;
REVOKE ALL ON FUNCTION public.cash_flow_statement(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.cash_flow_statement(date, date) TO authenticated;
-- Add detailed cash flow statement with line items
CREATE OR REPLACE FUNCTION public.cash_flow_detailed(p_start date, p_end date)
RETURNS TABLE(
  category text,
  description text,
  amount numeric
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cash_accounts AS (
    SELECT id FROM public.chart_of_accounts 
    WHERE code IN ('1010', '1020') AND is_active = true
  ),
  cash_movements AS (
    SELECT
      je.source_table,
      je.source_event,
      je.memo,
      SUM(jl.debit - jl.credit) as net_amount,
      je.entry_date
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id IN (SELECT id FROM cash_accounts)
      AND (p_start IS NULL OR je.entry_date::date >= p_start)
      AND (p_end IS NULL OR je.entry_date::date <= p_end)
      AND public.can_view_reports()
    GROUP BY je.id, je.source_table, je.source_event, je.memo, je.entry_date
    HAVING SUM(jl.debit - jl.credit) != 0
  )
  SELECT
    'Operating' as category,
    COALESCE(
      CASE 
        WHEN cm.source_table = 'orders' THEN 'Cash from sales'
        WHEN cm.source_table = 'payments' AND cm.net_amount > 0 THEN 'Customer payments received'
        WHEN cm.source_table = 'payments' AND cm.net_amount < 0 THEN 'Supplier payments made'
        WHEN cm.source_table = 'expenses' THEN 'Operating expenses paid'
        WHEN cm.source_table = 'sales_returns' THEN 'Cash refunds for returns'
        WHEN cm.source_table = 'cash_shifts' THEN 'Cash shift adjustments'
        ELSE cm.memo
      END,
      'Other operating cash flow'
    ) as description,
    cm.net_amount as amount
  FROM cash_movements cm
  ORDER BY cm.entry_date, cm.net_amount DESC;
$$;
REVOKE ALL ON FUNCTION public.cash_flow_detailed(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.cash_flow_detailed(date, date) TO authenticated;
-- Add comments
COMMENT ON FUNCTION public.cash_flow_statement(date, date) IS 'Returns cash flow statement summary for the specified period';
COMMENT ON FUNCTION public.cash_flow_detailed(date, date) IS 'Returns detailed cash flow line items for the specified period';
