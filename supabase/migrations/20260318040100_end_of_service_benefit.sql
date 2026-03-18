-- ======================================================================
-- Migration: مكافأة نهاية الخدمة (EOSB - End of Service Benefit)
-- Creates eosb_accruals table and compute/run functions
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Create employee EOSB accruals table
CREATE TABLE IF NOT EXISTS public.employee_eosb_accruals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID        NOT NULL REFERENCES public.payroll_employees(id) ON DELETE CASCADE,
  period_ym             CHAR(7)     NOT NULL,  -- e.g. '2026-03'
  years_of_service      NUMERIC(6,4) NOT NULL DEFAULT 0,
  monthly_salary_at_calc NUMERIC(15,4) NOT NULL DEFAULT 0,
  total_allowances_at_calc NUMERIC(15,4) NOT NULL DEFAULT 0,
  base_for_eosb         NUMERIC(15,4) NOT NULL DEFAULT 0, -- salary + allowances (configurable)
  accrual_days          NUMERIC(6,4) NOT NULL DEFAULT 0,  -- days of entitlement this month
  accrual_amount        NUMERIC(15,4) NOT NULL DEFAULT 0, -- amount accrued this month
  cumulative_amount     NUMERIC(15,4) NOT NULL DEFAULT 0, -- total cumulative to date
  currency              TEXT        NOT NULL DEFAULT 'YER',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_ym)
);

CREATE INDEX IF NOT EXISTS idx_eosb_employee_period
  ON public.employee_eosb_accruals(employee_id, period_ym DESC);

COMMENT ON TABLE public.employee_eosb_accruals IS 'مكافأة نهاية الخدمة — استحقاق شهري لكل موظف';

-- 2. EOSB settings table (configurable per company)
CREATE TABLE IF NOT EXISTS public.eosb_settings (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  include_allowances BOOLEAN NOT NULL DEFAULT false,  -- هل تشمل البدلات قاعدة الاحتساب؟
  days_per_year_1   NUMERIC(6,4) NOT NULL DEFAULT 30, -- أيام/سنة للسنوات 1-5
  days_per_year_2   NUMERIC(6,4) NOT NULL DEFAULT 30, -- أيام/سنة بعد 5 سنوات
  min_years_to_qualify NUMERIC(4,2) NOT NULL DEFAULT 1.0, -- الحد الأدنى للاستحقاق
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default settings if not exist
INSERT INTO public.eosb_settings (id, include_allowances, days_per_year_1, days_per_year_2, min_years_to_qualify)
VALUES (gen_random_uuid(), false, 30, 30, 1.0)
ON CONFLICT DO NOTHING;

-- 3. Function: compute EOSB for a single employee for a given month
CREATE OR REPLACE FUNCTION public.compute_eosb_for_employee(
  p_employee_id UUID,
  p_period_ym   CHAR(7)  -- e.g. '2026-03'
)
RETURNS TABLE (
  employee_id           UUID,
  period_ym             CHAR(7),
  years_of_service      NUMERIC,
  base_for_eosb         NUMERIC,
  accrual_days          NUMERIC,
  accrual_amount        NUMERIC,
  cumulative_amount     NUMERIC,
  currency              TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp             RECORD;
  v_settings        RECORD;
  v_years           NUMERIC;
  v_months          NUMERIC;
  v_base            NUMERIC;
  v_days_per_month  NUMERIC;
  v_accrual         NUMERIC;
  v_cumulative      NUMERIC;
  v_hired_date      DATE;
BEGIN
  SELECT * INTO v_settings FROM public.eosb_settings LIMIT 1;
  IF NOT FOUND THEN
    -- default values
    v_settings.include_allowances := false;
    v_settings.days_per_year_1 := 30;
    v_settings.days_per_year_2 := 30;
    v_settings.min_years_to_qualify := 1.0;
  END IF;

  SELECT pe.*,
         public.get_employee_total_allowances(pe.id) AS total_allowances
  INTO v_emp
  FROM public.payroll_employees pe
  WHERE pe.id = p_employee_id
    AND pe.is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Compute years of service up to end of p_period_ym
  v_hired_date := COALESCE(v_emp.hired_date::DATE, now()::DATE);
  DECLARE
    v_period_end DATE := (p_period_ym || '-01')::DATE + INTERVAL '1 month' - INTERVAL '1 day';
  BEGIN
    v_months := EXTRACT(EPOCH FROM (v_period_end - v_hired_date)) / 2592000.0; -- approx months
    v_years  := v_months / 12.0;
  END;

  -- Must meet minimum years
  IF v_years < v_settings.min_years_to_qualify THEN
    RETURN;
  END IF;

  -- Base for EOSB
  v_base := COALESCE(v_emp.monthly_salary, 0);
  IF v_settings.include_allowances THEN
    v_base := v_base + COALESCE(v_emp.total_allowances, 0);
  END IF;

  -- Days per month entitlement
  IF v_years <= 5 THEN
    v_days_per_month := v_settings.days_per_year_1 / 12.0;
  ELSE
    v_days_per_month := v_settings.days_per_year_2 / 12.0;
  END IF;

  -- Monthly EOSB accrual = (base / 30) * days_per_month
  v_accrual := (v_base / 30.0) * v_days_per_month;

  -- Cumulative = previous + this month
  SELECT COALESCE(SUM(ea.accrual_amount), 0) INTO v_cumulative
  FROM public.employee_eosb_accruals ea
  WHERE ea.employee_id = p_employee_id
    AND ea.period_ym < p_period_ym;

  v_cumulative := v_cumulative + v_accrual;

  RETURN QUERY SELECT
    p_employee_id,
    p_period_ym,
    v_years,
    v_base,
    v_days_per_month,
    v_accrual,
    v_cumulative,
    v_emp.currency;
END;
$$;

-- 4. Function: run EOSB accruals for all active employees for a period
CREATE OR REPLACE FUNCTION public.run_monthly_eosb_accruals(p_period_ym CHAR(7))
RETURNS TABLE (
  processed_count INT,
  total_accrual   NUMERIC,
  skipped_count   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp_id      UUID;
  v_result      RECORD;
  v_processed   INT := 0;
  v_skipped     INT := 0;
  v_total       NUMERIC := 0;
BEGIN
  FOR v_emp_id IN
    SELECT id FROM public.payroll_employees WHERE is_active = true
  LOOP
    SELECT * INTO v_result
    FROM public.compute_eosb_for_employee(v_emp_id, p_period_ym);

    IF NOT FOUND OR v_result.accrual_amount IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.employee_eosb_accruals (
      employee_id, period_ym, years_of_service,
      monthly_salary_at_calc, total_allowances_at_calc, base_for_eosb,
      accrual_days, accrual_amount, cumulative_amount, currency
    ) VALUES (
      v_emp_id, p_period_ym, v_result.years_of_service,
      (SELECT monthly_salary FROM public.payroll_employees WHERE id = v_emp_id),
      (SELECT public.get_employee_total_allowances(v_emp_id)),
      v_result.base_for_eosb,
      v_result.accrual_days, v_result.accrual_amount, v_result.cumulative_amount,
      v_result.currency
    )
    ON CONFLICT (employee_id, period_ym)
    DO UPDATE SET
      accrual_amount    = EXCLUDED.accrual_amount,
      cumulative_amount = EXCLUDED.cumulative_amount,
      base_for_eosb     = EXCLUDED.base_for_eosb;

    v_processed := v_processed + 1;
    v_total     := v_total + v_result.accrual_amount;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_total, v_skipped;
END;
$$;

COMMENT ON FUNCTION public.run_monthly_eosb_accruals IS 'يحتسب مكافأة نهاية الخدمة لجميع الموظفين النشطين لفترة معينة';
