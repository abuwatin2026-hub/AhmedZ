-- ======================================================================
-- Migration: طلبات التوظيف (Recruitment Module)
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Recruitment requests
CREATE TABLE IF NOT EXISTS public.recruitment_requests (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  job_title        TEXT    NOT NULL,
  department       TEXT,
  required_count   INT     NOT NULL DEFAULT 1 CHECK (required_count > 0),
  priority         TEXT    NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high','urgent')),
  status           TEXT    NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','on_hold','closed','cancelled')),
  description      TEXT,
  requirements     TEXT,  -- المتطلبات: خبرة، شهادات، إلخ
  salary_range_min NUMERIC(15,4),
  salary_range_max NUMERIC(15,4),
  currency         TEXT    NOT NULL DEFAULT 'YER',
  target_date      DATE,   -- التاريخ المستهدف للتعيين
  created_by       UUID    REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  approved_by      UUID    REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  filled_count     INT     NOT NULL DEFAULT 0,  -- عدد المعينين فعلياً
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_status
  ON public.recruitment_requests(status, created_at DESC);

COMMENT ON TABLE public.recruitment_requests IS 'طلبات التوظيف — نموذج الطلب الرسمي لكل وظيفة';

-- 2. Recruitment applicants
CREATE TABLE IF NOT EXISTS public.recruitment_applicants (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID    NOT NULL REFERENCES public.recruitment_requests(id) ON DELETE CASCADE,
  full_name        TEXT    NOT NULL,
  phone            TEXT,
  email            TEXT,
  national_id      TEXT,
  cv_url           TEXT,   -- رابط السيرة الذاتية (storage)
  source           TEXT    NOT NULL DEFAULT 'other'
                     CHECK (source IN ('referral','online','walk_in','agency','other')),
  status           TEXT    NOT NULL DEFAULT 'applied'
                     CHECK (status IN (
                       'applied','screening','interview_scheduled',
                       'interviewed','offer_sent','hired','rejected','withdrawn'
                     )),
  interview_date   TIMESTAMPTZ,
  interview_score  NUMERIC(5,2),  -- 0-100
  interview_notes  TEXT,
  offer_salary     NUMERIC(15,4),
  offer_currency   TEXT,
  hired_date       DATE,
  rejection_reason TEXT,
  reviewed_by      UUID    REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicants_request
  ON public.recruitment_applicants(request_id, status);

CREATE INDEX IF NOT EXISTS idx_applicants_status
  ON public.recruitment_applicants(status, created_at DESC);

COMMENT ON TABLE public.recruitment_applicants IS 'المرشحون لطلبات التوظيف';

-- 3. Function: update filled_count on request when applicant is hired
CREATE OR REPLACE FUNCTION public.trg_update_recruitment_filled_count_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'hired' AND (OLD.status IS NULL OR OLD.status <> 'hired') THEN
    UPDATE public.recruitment_requests
    SET filled_count = (
      SELECT COUNT(*) FROM public.recruitment_applicants
      WHERE request_id = NEW.request_id AND status = 'hired'
    ),
    updated_at = now()
    WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_update_recruitment_filled_count
  AFTER INSERT OR UPDATE OF status ON public.recruitment_applicants
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_recruitment_filled_count_fn();
