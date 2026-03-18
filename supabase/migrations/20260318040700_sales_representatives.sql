-- ======================================================================
-- Migration: مناديب المبيعات والعمولات (Sales Representatives & Commissions)
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Sales representatives table
CREATE TABLE IF NOT EXISTS public.sales_representatives (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         TEXT    NOT NULL,
  phone             TEXT,
  email             TEXT,
  national_id       TEXT,
  commission_type   TEXT    NOT NULL DEFAULT 'percentage'
                      CHECK (commission_type IN ('percentage','fixed_per_order','fixed_per_item')),
  commission_rate   NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0),
  -- If percentage: rate is % of net order value
  -- If fixed_per_order: rate is fixed amount per delivered order
  -- If fixed_per_item: rate is fixed amount per item sold
  currency          TEXT    NOT NULL DEFAULT 'YER',
  territory         TEXT,  -- المنطقة الجغرافية للمندوب
  target_monthly    NUMERIC(15,4) NOT NULL DEFAULT 0,  -- هدف شهري
  is_active         BOOLEAN NOT NULL DEFAULT true,
  party_id          UUID    REFERENCES public.financial_parties(id) ON DELETE SET NULL,
  payroll_employee_id UUID  REFERENCES public.payroll_employees(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sales_representatives IS 'مناديب المبيعات — التعريف والبيانات الأساسية';

-- 2. Link representatives to orders (additive column)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES public.sales_representatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_sales_rep
  ON public.orders(sales_rep_id)
  WHERE sales_rep_id IS NOT NULL;

COMMENT ON COLUMN public.orders.sales_rep_id IS 'المندوب المسؤول عن هذا الطلب';

-- 3. Sales rep commissions log
CREATE TABLE IF NOT EXISTS public.sales_rep_commissions (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id            UUID    NOT NULL REFERENCES public.sales_representatives(id) ON DELETE CASCADE,
  order_id          UUID    REFERENCES public.orders(id) ON DELETE SET NULL,
  period_ym         CHAR(7) NOT NULL,  -- 'YYYY-MM'
  order_net_amount  NUMERIC(15,4) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
  currency          TEXT    NOT NULL DEFAULT 'YER',
  status            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','paid','voided')),
  payroll_run_id    UUID    REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commissions_rep_period
  ON public.sales_rep_commissions(rep_id, period_ym DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_status
  ON public.sales_rep_commissions(status);

COMMENT ON TABLE public.sales_rep_commissions IS 'عمولات المناديب لكل فترة وكل طلب';

-- 4. Function: compute commissions for a period
CREATE OR REPLACE FUNCTION public.compute_rep_commissions(p_period_ym CHAR(7))
RETURNS TABLE (
  rep_id            UUID,
  rep_name          TEXT,
  order_count       INT,
  total_net         NUMERIC,
  total_commission  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rep     RECORD;
  v_period_start DATE;
  v_period_end   DATE;
BEGIN
  v_period_start := (p_period_ym || '-01')::DATE;
  v_period_end   := v_period_start + INTERVAL '1 month' - INTERVAL '1 second';

  FOR v_rep IN SELECT * FROM public.sales_representatives WHERE is_active = true LOOP
    DECLARE
      v_order    RECORD;
      v_comm     NUMERIC;
      v_count    INT := 0;
      v_total_net NUMERIC := 0;
      v_total_comm NUMERIC := 0;
    BEGIN
      FOR v_order IN
        SELECT o.id, o.total, o.created_at
        FROM public.orders o
        WHERE o.sales_rep_id = v_rep.id
          AND o.status = 'delivered'
          AND o.created_at BETWEEN v_period_start AND v_period_end
      LOOP
        CASE v_rep.commission_type
          WHEN 'percentage'      THEN v_comm := ROUND(v_order.total * v_rep.commission_rate / 100, 4);
          WHEN 'fixed_per_order' THEN v_comm := v_rep.commission_rate;
          ELSE v_comm := 0;
        END CASE;

        -- Upsert commission record
        INSERT INTO public.sales_rep_commissions (
          rep_id, order_id, period_ym, order_net_amount,
          commission_amount, currency, status
        ) VALUES (
          v_rep.id, v_order.id, p_period_ym, v_order.total,
          v_comm, v_rep.currency, 'pending'
        )
        ON CONFLICT DO NOTHING;

        v_count     := v_count + 1;
        v_total_net  := v_total_net + v_order.total;
        v_total_comm := v_total_comm + v_comm;
      END LOOP;

      IF v_count > 0 THEN
        RETURN QUERY SELECT v_rep.id, v_rep.full_name, v_count, v_total_net, v_total_comm;
      END IF;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.compute_rep_commissions IS 'يحسب عمولات جميع المناديب لفترة معينة';

-- 5. Function: rep performance summary
CREATE OR REPLACE FUNCTION public.get_rep_performance(
  p_rep_id    UUID,
  p_period_ym CHAR(7)
)
RETURNS TABLE (
  total_orders     BIGINT,
  total_revenue    NUMERIC,
  target_monthly   NUMERIC,
  achievement_pct  NUMERIC,
  total_commission NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COUNT(DISTINCT o.id),
    COALESCE(SUM(o.total), 0),
    sr.target_monthly,
    CASE WHEN sr.target_monthly > 0
         THEN ROUND(SUM(o.total) / sr.target_monthly * 100, 2)
         ELSE 0 END,
    COALESCE(SUM(c.commission_amount), 0)
  FROM public.sales_representatives sr
  LEFT JOIN public.orders o
    ON o.sales_rep_id = sr.id
    AND o.status = 'delivered'
    AND TO_CHAR(o.created_at, 'YYYY-MM') = p_period_ym
  LEFT JOIN public.sales_rep_commissions c
    ON c.rep_id = sr.id AND c.period_ym = p_period_ym
  WHERE sr.id = p_rep_id
  GROUP BY sr.target_monthly;
$$;
