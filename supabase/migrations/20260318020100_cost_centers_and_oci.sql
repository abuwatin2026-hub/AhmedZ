-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260318020100_cost_centers_and_oci.sql
--
-- Implements:
-- 1. Seed default cost centers (مراكز التكلفة الأساسية)
-- 2. Fix balance_sheet RPC to separate OCI (unrealized FX)
--    from regular income/expense
-- 3. Improve income_statement to show OCI section separately
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Seed default cost centers ────────────────────────────────
-- Insert only if table is empty to avoid duplicates
insert into public.cost_centers (code, name)
select code, name from (values
  ('CC-01', 'الإدارة العامة'),
  ('CC-02', 'المبيعات والتوزيع'),
  ('CC-03', 'المخازن والمستودعات'),
  ('CC-04', 'المشتريات والاستيراد'),
  ('CC-05', 'الموارد البشرية'),
  ('CC-06', 'المحاسبة والمالية'),
  ('CC-07', 'الصيانة والتشغيل'),
  ('CC-08', 'التسويق والترويج'),
  ('CC-09', 'خدمة العملاء'),
  ('CC-00', 'عام / بدون مركز تكلفة')
) as t(code, name)
where not exists (select 1 from public.cost_centers limit 1);

-- ─── 2. Enhanced balance_sheet with OCI section ──────────────────
-- Drop old version first since return type changes
drop function if exists public.balance_sheet(date, uuid);
drop function if exists public.balance_sheet(timestamptz, uuid);

create or replace function public.balance_sheet(
  p_as_of date default null,
  p_cost_center_id uuid default null
)
returns table(
  assets numeric,
  liabilities numeric,
  equity numeric,
  net_income numeric,
  oci_gain numeric,
  oci_loss numeric,
  total_equity numeric
)
language sql security definer set search_path = public
as $$
  with tb as (
    select * from public.trial_balance(null::date, p_as_of, p_cost_center_id, null::uuid)
  ),
  sums as (
    select
      coalesce(sum(case when tb.account_type = 'asset' then (tb.debit - tb.credit) else 0 end), 0) as assets,
      coalesce(sum(case when tb.account_type = 'liability' then (tb.credit - tb.debit) else 0 end), 0) as liabilities,
      coalesce(sum(case when tb.account_type = 'equity' then (tb.credit - tb.debit) else 0 end), 0) as equity_base,
      -- Regular P&L (exclude OCI accounts 6250/6251)
      coalesce(sum(case
        when tb.account_type = 'income' and tb.account_code not in ('6250')
        then (tb.credit - tb.debit) else 0 end), 0) as income_sum,
      coalesce(sum(case
        when tb.account_type = 'expense' and tb.account_code not in ('6251')
        then (tb.debit - tb.credit) else 0 end), 0) as expense_sum,
      -- OCI: unrealized FX gains/losses (balance sheet equity adjustment)
      coalesce(sum(case when tb.account_code = '6250' then (tb.credit - tb.debit) else 0 end), 0) as oci_gain,
      coalesce(sum(case when tb.account_code = '6251' then (tb.debit - tb.credit) else 0 end), 0) as oci_loss
    from tb
  )
  select
    s.assets,
    s.liabilities,
    (s.equity_base + (s.income_sum - s.expense_sum)) as equity,
    (s.income_sum - s.expense_sum) as net_income,
    s.oci_gain,
    s.oci_loss,
    (s.equity_base + (s.income_sum - s.expense_sum) + s.oci_gain - s.oci_loss) as total_equity
  from sums s;
$$;

-- ─── 3. Income statement with OCI section ────────────────────────
create or replace function public.income_statement_with_oci(
  p_from date default null,
  p_to date default null,
  p_cost_center_id uuid default null
)
returns jsonb
language sql security definer set search_path = public
as $$
  with tb as (
    select * from public.trial_balance(p_from, p_to, p_cost_center_id, null::uuid)
  )
  select jsonb_build_object(
    'revenue', coalesce(sum(case
      when tb.account_type = 'income' and tb.account_code not in ('6200','6201','6250','6251')
      then (tb.credit - tb.debit) else 0 end), 0),
    'cost_of_goods', coalesce(sum(case
      when tb.account_code in ('5010','5020','5030') then (tb.debit - tb.credit) else 0 end), 0),
    'gross_profit', coalesce(sum(case
      when tb.account_type = 'income' and tb.account_code not in ('6200','6201','6250','6251')
      then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_code in ('5010','5020','5030') then (tb.debit - tb.credit) else 0 end), 0),
    'operating_expenses', coalesce(sum(case
      when tb.account_type = 'expense' and tb.account_code not in ('5010','5020','5030','6201','6251')
      then (tb.debit - tb.credit) else 0 end), 0),
    'fx_gain_realized', coalesce(sum(case when tb.account_code = '6200' then (tb.credit - tb.debit) else 0 end), 0),
    'fx_loss_realized', coalesce(sum(case when tb.account_code = '6201' then (tb.debit - tb.credit) else 0 end), 0),
    'net_income', coalesce(sum(case
      when tb.account_type = 'income' and tb.account_code not in ('6250','6251')
      then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case
      when tb.account_type = 'expense' and tb.account_code not in ('6251')
      then (tb.debit - tb.credit) else 0 end), 0),
    -- OCI Section (below-the-line)
    'oci', jsonb_build_object(
      'fx_gain_unrealized', coalesce(sum(case when tb.account_code = '6250' then (tb.credit - tb.debit) else 0 end), 0),
      'fx_loss_unrealized', coalesce(sum(case when tb.account_code = '6251' then (tb.debit - tb.credit) else 0 end), 0),
      'total_oci', coalesce(sum(case when tb.account_code = '6250' then (tb.credit - tb.debit) else 0 end), 0)
                 - coalesce(sum(case when tb.account_code = '6251' then (tb.debit - tb.credit) else 0 end), 0)
    ),
    'total_comprehensive_income', (
      coalesce(sum(case
        when tb.account_type = 'income' and tb.account_code not in ('6250','6251')
        then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case
        when tb.account_type = 'expense' and tb.account_code not in ('6251')
        then (tb.debit - tb.credit) else 0 end), 0)
      + coalesce(sum(case when tb.account_code = '6250' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_code = '6251' then (tb.debit - tb.credit) else 0 end), 0)
    )
  ) from tb;
$$;

grant execute on function public.balance_sheet(date, uuid) to authenticated;
grant execute on function public.income_statement_with_oci(date, date, uuid) to authenticated;

-- ─── 4. Add OCI equity accounts to chart of accounts if missing ───
insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
values
  ('3010', 'فروق تقييم العملات الأجنبية (OCI)', 'equity', 'credit', true)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
