-- ======================================================================
-- Migration: طلبات صرف المخزون (Inventory Withdrawal Requests)
-- Adds a request-before-issue approval workflow for stock withdrawals
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Withdrawal requests header
CREATE TABLE IF NOT EXISTS public.inventory_withdrawal_requests (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT    NOT NULL DEFAULT ('WD-' || TO_CHAR(now(), 'YYYYMMDD-') || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6))),
  warehouse_id     UUID    NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  branch_id        UUID    REFERENCES public.branches(id) ON DELETE SET NULL,
  requested_by     UUID    REFERENCES public.admin_users(id) ON DELETE SET NULL,
  approved_by      UUID    REFERENCES public.admin_users(id) ON DELETE SET NULL,
  rejected_by      UUID    REFERENCES public.admin_users(id) ON DELETE SET NULL,
  status           TEXT    NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','pending_approval','approved','rejected','fulfilled','cancelled')),
  purpose          TEXT,   -- الغرض من الصرف
  department       TEXT,   -- الإدارة الطالبة
  required_date    DATE,   -- التاريخ المطلوب للصرف
  rejection_reason TEXT,
  fulfilled_at     TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_status
  ON public.inventory_withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_warehouse
  ON public.inventory_withdrawal_requests(warehouse_id, status);

COMMENT ON TABLE public.inventory_withdrawal_requests IS 'طلبات صرف المخزون — يسبق عملية الصرف الفعلية';

-- 2. Withdrawal request items
CREATE TABLE IF NOT EXISTS public.inventory_withdrawal_items (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID    NOT NULL REFERENCES public.inventory_withdrawal_requests(id) ON DELETE CASCADE,
  item_id          UUID    NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  requested_qty    NUMERIC(15,6) NOT NULL DEFAULT 0 CHECK (requested_qty > 0),
  approved_qty     NUMERIC(15,6),   -- قد تختلف عن المطلوبة
  fulfilled_qty    NUMERIC(15,6) NOT NULL DEFAULT 0,
  uom_code         TEXT,
  unit_cost        NUMERIC(15,4),   -- يُعبأ عند الصرف
  notes            TEXT,
  movement_id      UUID    REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_items_request
  ON public.inventory_withdrawal_items(request_id);

COMMENT ON TABLE public.inventory_withdrawal_items IS 'تفاصيل أصناف طلب الصرف المخزني';

-- 3. Function: submit withdrawal request for approval
CREATE OR REPLACE FUNCTION public.submit_withdrawal_request(p_request_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.inventory_withdrawal_requests
  SET status     = 'pending_approval',
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يمكن تقديم الطلب: الطلب غير موجود أو ليس في حالة مسودة.';
  END IF;

  RETURN 'pending_approval';
END;
$$;

-- 4. Function: approve withdrawal request
CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(
  p_request_id   UUID,
  p_approver_id  UUID,
  p_approved_qtys JSONB DEFAULT NULL  -- {item_id: approved_qty} optional overrides
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.inventory_withdrawal_requests
  SET status      = 'approved',
      approved_by = p_approver_id,
      updated_at  = now()
  WHERE id = p_request_id
    AND status = 'pending_approval';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يمكن اعتماد الطلب: الطلب غير موجود أو ليس في انتظار الاعتماد.';
  END IF;

  -- Apply approved quantity overrides if provided
  IF p_approved_qtys IS NOT NULL THEN
    UPDATE public.inventory_withdrawal_items wi
    SET approved_qty = (p_approved_qtys ->> wi.item_id::TEXT)::NUMERIC
    WHERE wi.request_id = p_request_id
      AND (p_approved_qtys ->> wi.item_id::TEXT) IS NOT NULL;
  ELSE
    -- Default: approved_qty = requested_qty
    UPDATE public.inventory_withdrawal_items
    SET approved_qty = requested_qty
    WHERE request_id = p_request_id AND approved_qty IS NULL;
  END IF;

  RETURN 'approved';
END;
$$;

-- 5. Function: reject withdrawal request
CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(
  p_request_id  UUID,
  p_rejector_id UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.inventory_withdrawal_requests
  SET status           = 'rejected',
      rejected_by      = p_rejector_id,
      rejection_reason = p_reason,
      updated_at       = now()
  WHERE id = p_request_id
    AND status IN ('pending_approval','draft');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يمكن رفض الطلب.';
  END IF;

  RETURN 'rejected';
END;
$$;

-- 6. Function: fulfill approved withdrawal request (actually deduct from stock)
CREATE OR REPLACE FUNCTION public.fulfill_withdrawal_request(
  p_request_id     UUID,
  p_performed_by   UUID DEFAULT NULL
)
RETURNS INT  -- count of movements created
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req       RECORD;
  v_item      RECORD;
  v_mv_id     UUID;
  v_count     INT := 0;
BEGIN
  SELECT * INTO v_req FROM public.inventory_withdrawal_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود.'; END IF;
  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'الطلب يجب أن يكون معتمداً قبل الصرف. الحالة الحالية: %', v_req.status;
  END IF;

  FOR v_item IN
    SELECT * FROM public.inventory_withdrawal_items WHERE request_id = p_request_id
  LOOP
    DECLARE
      v_qty NUMERIC := COALESCE(v_item.approved_qty, v_item.requested_qty);
    BEGIN
      IF v_qty <= 0 THEN CONTINUE; END IF;

      v_mv_id := gen_random_uuid();
      INSERT INTO public.inventory_movements (
        id, item_id, warehouse_id, movement_type,
        quantity_change, quantity_change_base,
        notes, reference_id, reference_type
      ) VALUES (
        v_mv_id, v_item.item_id, v_req.warehouse_id, 'withdrawal_issue',
        -v_qty, -v_qty,
        COALESCE(v_req.purpose, 'صرف مخزني'),
        p_request_id, 'inventory_withdrawal_requests'
      );

      UPDATE public.inventory_withdrawal_items
      SET fulfilled_qty = v_qty,
          movement_id   = v_mv_id
      WHERE id = v_item.id;

      v_count := v_count + 1;
    END;
  END LOOP;

  UPDATE public.inventory_withdrawal_requests
  SET status       = 'fulfilled',
      fulfilled_at = now(),
      updated_at   = now()
  WHERE id = p_request_id;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.fulfill_withdrawal_request IS 'ينفذ صرف المخزون لطلب معتمد ويسجل حركات المخزون';
