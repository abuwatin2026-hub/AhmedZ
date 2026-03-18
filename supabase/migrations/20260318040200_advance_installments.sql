-- ======================================================================
-- Migration: جدولة أقساط السلف للموظفين
-- Creates advance_installments table and scheduling function
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Employee advance installments table
CREATE TABLE IF NOT EXISTS public.employee_advance_installments (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_party_doc_id   UUID        REFERENCES public.party_documents(id) ON DELETE SET NULL,
  employee_party_id      UUID        NOT NULL REFERENCES public.financial_parties(id) ON DELETE CASCADE,
  employee_payroll_id    UUID        REFERENCES public.payroll_employees(id) ON DELETE SET NULL,
  installment_month      CHAR(7)     NOT NULL,  -- 'YYYY-MM'
  installment_amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
  currency               TEXT        NOT NULL DEFAULT 'YER',
  status                 TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','deducted','skipped','cancelled')),
  payroll_run_id         UUID        REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  deducted_at            TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_installments_party_month
  ON public.employee_advance_installments(employee_party_id, installment_month);

CREATE INDEX IF NOT EXISTS idx_advance_installments_payroll_id
  ON public.employee_advance_installments(payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_advance_installments_status
  ON public.employee_advance_installments(status);

COMMENT ON TABLE public.employee_advance_installments IS 'جدول أقساط السلف الشهرية للموظفين';

-- 2. Function: schedule advance installments
CREATE OR REPLACE FUNCTION public.schedule_advance_installments(
  p_employee_payroll_id UUID,
  p_total_amount        NUMERIC,
  p_months              INT,
  p_start_month         CHAR(7),   -- 'YYYY-MM'
  p_currency            TEXT DEFAULT 'YER',
  p_party_doc_id        UUID DEFAULT NULL,
  p_notes               TEXT DEFAULT NULL
)
RETURNS TABLE (
  installment_month CHAR(7),
  installment_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly_amount  NUMERIC;
  v_remainder       NUMERIC;
  v_party_id        UUID;
  v_month_cursor    DATE;
  v_month_str       CHAR(7);
  i                 INT;
BEGIN
  IF p_months <= 0 OR p_total_amount <= 0 THEN
    RAISE EXCEPTION 'عدد الأشهر والمبلغ الكلي يجب أن يكونا أكبر من صفر';
  END IF;

  -- Get party_id from payroll employee
  SELECT party_id INTO v_party_id
  FROM public.payroll_employees
  WHERE id = p_employee_payroll_id;

  IF v_party_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم ربط الموظف بطرف مالي. أكمل إعداد الموظف في الرواتب أولاً.';
  END IF;

  v_monthly_amount := ROUND(p_total_amount / p_months, 4);
  v_remainder      := ROUND(p_total_amount - (v_monthly_amount * p_months), 4);

  v_month_cursor := (p_start_month || '-01')::DATE;

  FOR i IN 1..p_months LOOP
    v_month_str := TO_CHAR(v_month_cursor, 'YYYY-MM');
    DECLARE
      v_amount NUMERIC := v_monthly_amount + CASE WHEN i = p_months THEN v_remainder ELSE 0 END;
    BEGIN
      INSERT INTO public.employee_advance_installments (
        advance_party_doc_id, employee_party_id, employee_payroll_id,
        installment_month, installment_amount, currency, status, notes
      ) VALUES (
        p_party_doc_id, v_party_id, p_employee_payroll_id,
        v_month_str, v_amount, p_currency, 'pending', p_notes
      );
      RETURN QUERY SELECT v_month_str, v_amount;
    END;
    v_month_cursor := v_month_cursor + INTERVAL '1 month';
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.schedule_advance_installments IS 'ينشئ جدول أقساط شهرية لسلفة موظف';

-- 3. Function: get pending installments for a payroll period
CREATE OR REPLACE FUNCTION public.get_pending_advance_installments(p_period_ym CHAR(7))
RETURNS TABLE (
  installment_id        UUID,
  employee_payroll_id   UUID,
  employee_name         TEXT,
  employee_party_id     UUID,
  installment_amount    NUMERIC,
  currency              TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ai.id,
    ai.employee_payroll_id,
    pe.full_name,
    ai.employee_party_id,
    ai.installment_amount,
    ai.currency
  FROM public.employee_advance_installments ai
  LEFT JOIN public.payroll_employees pe ON pe.id = ai.employee_payroll_id
  WHERE ai.installment_month = p_period_ym
    AND ai.status = 'pending'
  ORDER BY pe.full_name;
$$;

-- 4. Function: mark installments as deducted in a payroll run
CREATE OR REPLACE FUNCTION public.mark_installments_deducted(
  p_installment_ids UUID[],
  p_payroll_run_id  UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.employee_advance_installments
  SET status       = 'deducted',
      payroll_run_id = p_payroll_run_id,
      deducted_at  = now(),
      updated_at   = now()
  WHERE id = ANY(p_installment_ids)
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_installments_deducted IS 'يحدد الأقساط المخصومة في مسير الرواتب';
