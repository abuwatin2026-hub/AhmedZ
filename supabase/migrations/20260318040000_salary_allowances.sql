-- ======================================================================
-- Migration: بدلات الراتب المستقلة
-- Adds housing, transport, food, and other allowances to payroll_employees
-- ADDITIVE ONLY - no existing columns or functions are modified
-- ======================================================================

-- 1. Add allowance columns to payroll_employees
ALTER TABLE public.payroll_employees
  ADD COLUMN IF NOT EXISTS housing_allowance   NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_allowance NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_allowance      NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_allowances    NUMERIC(15,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_employees.housing_allowance   IS 'بدل السكن الشهري';
COMMENT ON COLUMN public.payroll_employees.transport_allowance IS 'بدل المواصلات الشهري';
COMMENT ON COLUMN public.payroll_employees.food_allowance      IS 'بدل الغذاء الشهري';
COMMENT ON COLUMN public.payroll_employees.other_allowances    IS 'بدلات أخرى شهرية';

-- 2. Add allowances_breakdown to payroll_run_lines for detailed reporting
ALTER TABLE public.payroll_run_lines
  ADD COLUMN IF NOT EXISTS housing_allowance   NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_allowance NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_allowance      NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_allowances    NUMERIC(15,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_run_lines.housing_allowance   IS 'بدل السكن المحتسب في هذا الشهر';
COMMENT ON COLUMN public.payroll_run_lines.transport_allowance IS 'بدل المواصلات المحتسب في هذا الشهر';
COMMENT ON COLUMN public.payroll_run_lines.food_allowance      IS 'بدل الغذاء المحتسب في هذا الشهر';
COMMENT ON COLUMN public.payroll_run_lines.other_allowances    IS 'بدلات أخرى محتسبة في هذا الشهر';

-- 3. Helper function: compute total allowances for an employee
CREATE OR REPLACE FUNCTION public.get_employee_total_allowances(p_employee_id UUID)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(housing_allowance, 0)
       + COALESCE(transport_allowance, 0)
       + COALESCE(food_allowance, 0)
       + COALESCE(other_allowances, 0)
  FROM public.payroll_employees
  WHERE id = p_employee_id;
$$;

COMMENT ON FUNCTION public.get_employee_total_allowances IS 'Returns the sum of all monthly allowances for an employee';
