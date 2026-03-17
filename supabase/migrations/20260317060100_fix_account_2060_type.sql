-- ════════════════════════════════════════════════════════════════════
-- Fix account 2060 (Import Cost Clearing / تسوية تكاليف الاستيراد)
-- Currently classified as 'asset' but should be 'liability'
-- The 2xxx range is reserved for liabilities in the chart of accounts.
-- ════════════════════════════════════════════════════════════════════

update public.chart_of_accounts
set account_type   = 'liability',
    normal_balance = 'credit'
where code = '2060'
  and account_type = 'asset';

notify pgrst, 'reload schema';
