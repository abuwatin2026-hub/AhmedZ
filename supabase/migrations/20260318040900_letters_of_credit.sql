-- ======================================================================
-- Migration: الاعتمادات المستندية (Letters of Credit — LC)
-- Complete LC module: header, drawdowns, expenses, PO links
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Letters of Credit main table
CREATE TABLE IF NOT EXISTS public.letters_of_credit (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number  TEXT    NOT NULL UNIQUE,
  supplier_id       UUID    REFERENCES public.suppliers(id) ON DELETE SET NULL,
  bank_name         TEXT    NOT NULL,   -- البنك المصدر للاعتماد
  beneficiary_bank  TEXT,               -- البنك المستفيد
  currency          TEXT    NOT NULL DEFAULT 'USD',
  lc_amount         NUMERIC(16,4) NOT NULL CHECK (lc_amount > 0),
  utilized_amount   NUMERIC(16,4) NOT NULL DEFAULT 0, -- المبلغ المستخدم فعلياً
  open_date         DATE    NOT NULL,
  expiry_date       DATE    NOT NULL CHECK (expiry_date > open_date),
  last_shipment_date DATE,
  status            TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','opened','partially_drawn','fully_drawn','expired','cancelled')),
  lc_type           TEXT    NOT NULL DEFAULT 'sight'
                      CHECK (lc_type IN ('sight','usance','revolving','standby')),
  payment_terms     TEXT,   -- شروط الدفع
  incoterms         TEXT,   -- شروط التسليم: FOB, CIF, إلخ
  port_of_loading   TEXT,
  port_of_discharge TEXT,
  document_requirements TEXT, -- متطلبات الوثائق
  charges_account_id UUID  REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  notes             TEXT,
  created_by        UUID    REFERENCES public.admin_users(auth_user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lc_status      ON public.letters_of_credit(status);
CREATE INDEX IF NOT EXISTS idx_lc_supplier     ON public.letters_of_credit(supplier_id);
CREATE INDEX IF NOT EXISTS idx_lc_expiry       ON public.letters_of_credit(expiry_date);

COMMENT ON TABLE public.letters_of_credit IS 'الاعتمادات المستندية — نظام متكامل لإدارة LCs';

-- 2. LC Drawdowns (سحبات/شحنات الاعتماد)
CREATE TABLE IF NOT EXISTS public.lc_drawdowns (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_id            UUID    NOT NULL REFERENCES public.letters_of_credit(id) ON DELETE CASCADE,
  drawdown_date    DATE    NOT NULL,
  drawdown_amount  NUMERIC(16,4) NOT NULL CHECK (drawdown_amount > 0),
  currency         TEXT    NOT NULL,
  documents_ref    TEXT,    -- رقم مرجع الوثائق
  bl_number        TEXT,    -- رقم بوليصة الشحن
  commercial_invoice_number TEXT,
  notes            TEXT,
  shipment_id      UUID    REFERENCES public.import_shipments(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lc_drawdowns_lc ON public.lc_drawdowns(lc_id);

COMMENT ON TABLE public.lc_drawdowns IS 'سحبات الاعتماد المستندي';

-- 3. LC Expenses (مصاريف الاعتماد)
CREATE TABLE IF NOT EXISTS public.lc_expenses (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_id         UUID    NOT NULL REFERENCES public.letters_of_credit(id) ON DELETE CASCADE,
  expense_type  TEXT    NOT NULL
                  CHECK (expense_type IN (
                    'opening_commission','amendment_fee','bank_charges',
                    'insurance','freight','customs','inspection','other'
                  )),
  description   TEXT,
  amount        NUMERIC(16,4) NOT NULL CHECK (amount > 0),
  currency      TEXT    NOT NULL DEFAULT 'USD',
  expense_date  DATE    NOT NULL,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lc_expenses_lc ON public.lc_expenses(lc_id);

COMMENT ON TABLE public.lc_expenses IS 'مصاريف الاعتمادات المستندية';

-- 4. LC — Purchase Orders link
CREATE TABLE IF NOT EXISTS public.lc_purchase_orders (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_id             UUID    NOT NULL REFERENCES public.letters_of_credit(id) ON DELETE CASCADE,
  purchase_order_id UUID    NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  allocated_amount  NUMERIC(16,4),  -- المبلغ المخصص من الاعتماد لهذا الأمر
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lc_id, purchase_order_id)
);

COMMENT ON TABLE public.lc_purchase_orders IS 'ربط الاعتمادات المستندية بأوامر الشراء';

-- 5. Trigger: update utilized_amount when drawdown is added
CREATE OR REPLACE FUNCTION public.trg_update_lc_utilized_amount_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.letters_of_credit
  SET utilized_amount = (
        SELECT COALESCE(SUM(d.drawdown_amount), 0)
        FROM public.lc_drawdowns d
        WHERE d.lc_id = COALESCE(NEW.lc_id, OLD.lc_id)
      ),
      status = CASE
        WHEN (SELECT COALESCE(SUM(d.drawdown_amount),0) FROM public.lc_drawdowns d
              WHERE d.lc_id = COALESCE(NEW.lc_id, OLD.lc_id))
             >= lc_amount THEN 'fully_drawn'
        WHEN (SELECT COALESCE(SUM(d.drawdown_amount),0) FROM public.lc_drawdowns d
              WHERE d.lc_id = COALESCE(NEW.lc_id, OLD.lc_id)) > 0 THEN 'partially_drawn'
        WHEN status NOT IN ('cancelled','expired') THEN 'opened'
        ELSE status
        END,
      updated_at = now()
  WHERE id = COALESCE(NEW.lc_id, OLD.lc_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_update_lc_utilized_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.lc_drawdowns
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_lc_utilized_amount_fn();

-- 6. Function: get LC summary with remaining balance
CREATE OR REPLACE FUNCTION public.get_lc_summary(p_lc_id UUID)
RETURNS TABLE (
  lc_id             UUID,
  reference_number  TEXT,
  supplier_name     TEXT,
  lc_amount         NUMERIC,
  utilized_amount   NUMERIC,
  remaining_amount  NUMERIC,
  total_expenses    NUMERIC,
  currency          TEXT,
  status            TEXT,
  expiry_date       DATE
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT
    lc.id,
    lc.reference_number,
    s.name AS supplier_name,
    lc.lc_amount,
    lc.utilized_amount,
    lc.lc_amount - lc.utilized_amount AS remaining_amount,
    COALESCE((SELECT SUM(e.amount) FROM public.lc_expenses e WHERE e.lc_id = lc.id), 0) AS total_expenses,
    lc.currency,
    lc.status,
    lc.expiry_date
  FROM public.letters_of_credit lc
  LEFT JOIN public.suppliers s ON s.id = lc.supplier_id
  WHERE lc.id = p_lc_id;
$$;

COMMENT ON FUNCTION public.get_lc_summary IS 'ملخص الاعتماد المستندي مع الرصيد المتبقي والمصاريف';
