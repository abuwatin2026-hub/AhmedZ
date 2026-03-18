-- ======================================================================
-- Migration: تقييم أداء الموظفين
-- Creates performance review criteria and reviews tables
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Performance review criteria table
CREATE TABLE IF NOT EXISTS public.performance_review_criteria (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  description TEXT,
  weight      NUMERIC(5,2) NOT NULL DEFAULT 1.0 CHECK (weight > 0),
  max_score   NUMERIC(5,2) NOT NULL DEFAULT 5.0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.performance_review_criteria IS 'معايير تقييم الأداء الوظيفي';

-- Insert default criteria
INSERT INTO public.performance_review_criteria (name, description, weight, max_score, sort_order) VALUES
  ('الالتزام بالحضور',    'الانضباط في الوقت والحضور',         1.0, 5.0, 1),
  ('جودة العمل',          'دقة وجودة المهام المنجزة',           1.5, 5.0, 2),
  ('التعاون وروح الفريق', 'مدى التعاون مع الزملاء',             1.0, 5.0, 3),
  ('المبادرة والإبداع',   'قدرة الموظف على الاقتراح والتطوير', 1.0, 5.0, 4),
  ('الكفاءة والإنتاجية',  'كمية الإنجاز في الوقت المحدد',       1.5, 5.0, 5)
ON CONFLICT DO NOTHING;

-- 2. Performance reviews table
CREATE TABLE IF NOT EXISTS public.performance_reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID        NOT NULL REFERENCES public.payroll_employees(id) ON DELETE CASCADE,
  review_period   CHAR(7)     NOT NULL,   -- e.g. '2026-Q1' or '2026-01'
  review_type     TEXT        NOT NULL DEFAULT 'monthly'
                    CHECK (review_type IN ('monthly','quarterly','annual','probation')),
  reviewer_id     UUID        REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  scores          JSONB       NOT NULL DEFAULT '{}',  -- {criteria_id: score}
  weighted_total  NUMERIC(6,3) NOT NULL DEFAULT 0,
  max_possible    NUMERIC(6,3) NOT NULL DEFAULT 0,
  overall_percent NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0-100
  grade           TEXT        CHECK (grade IN ('ممتاز','جيد جداً','جيد','مقبول','ضعيف')),
  comments        TEXT,
  improvement_plan TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','submitted','approved')),
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID        REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee
  ON public.performance_reviews(employee_id, review_period DESC);

CREATE INDEX IF NOT EXISTS idx_perf_reviews_status
  ON public.performance_reviews(status);

COMMENT ON TABLE public.performance_reviews IS 'تقييمات أداء الموظفين';

-- 3. Function: compute weighted score for a review
CREATE OR REPLACE FUNCTION public.compute_review_weighted_score(p_review_id UUID)
RETURNS TABLE (
  weighted_total  NUMERIC,
  max_possible    NUMERIC,
  overall_percent NUMERIC,
  grade           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_review       RECORD;
  v_crit         RECORD;
  v_score        NUMERIC;
  v_total        NUMERIC := 0;
  v_max          NUMERIC := 0;
  v_percent      NUMERIC;
  v_grade        TEXT;
BEGIN
  SELECT * INTO v_review FROM public.performance_reviews WHERE id = p_review_id;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_crit IN
    SELECT * FROM public.performance_review_criteria WHERE is_active = true
  LOOP
    v_score := COALESCE((v_review.scores ->> v_crit.id::TEXT)::NUMERIC, 0);
    v_total := v_total + (v_score * v_crit.weight);
    v_max   := v_max   + (v_crit.max_score * v_crit.weight);
  END LOOP;

  IF v_max > 0 THEN
    v_percent := ROUND((v_total / v_max) * 100, 2);
  ELSE
    v_percent := 0;
  END IF;

  v_grade := CASE
    WHEN v_percent >= 90 THEN 'ممتاز'
    WHEN v_percent >= 75 THEN 'جيد جداً'
    WHEN v_percent >= 60 THEN 'جيد'
    WHEN v_percent >= 50 THEN 'مقبول'
    ELSE 'ضعيف'
  END;

  -- Update the review row
  UPDATE public.performance_reviews
  SET weighted_total  = v_total,
      max_possible    = v_max,
      overall_percent = v_percent,
      grade           = v_grade,
      updated_at      = now()
  WHERE id = p_review_id;

  RETURN QUERY SELECT v_total, v_max, v_percent, v_grade;
END;
$$;

COMMENT ON FUNCTION public.compute_review_weighted_score IS 'يحسب درجة التقييم المرجح والتقدير الحرفي';
