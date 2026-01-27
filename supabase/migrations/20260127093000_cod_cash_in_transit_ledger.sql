-- COD Cash Control (Accrual + Cash-in-Transit + Driver Ledger)
-- Frontend + Backend + Database: full accounting-safe lifecycle for COD without mixing delivery with cash-in-hand.

-- 1) Minimal COD Ledger Chart of Accounts (logical enum for ledger_lines.account)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_account_code') THEN
    CREATE TYPE public.ledger_account_code AS ENUM (
      'Sales_Revenue',
      'Accounts_Receivable_COD',
      'Cash_In_Transit',
      'Cash_On_Hand'
    );
  END IF;
END $$;

-- 2) Ledger tables (immutable)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('delivery', 'settlement')),
  reference_type text NOT NULL CHECK (reference_type IN ('order', 'settlement')),
  reference_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_ref
ON public.ledger_entries(entry_type, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref
ON public.ledger_entries(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS public.ledger_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  account public.ledger_account_code NOT NULL,
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_ledger_lines_entry_id
ON public.ledger_lines(entry_id);

CREATE INDEX IF NOT EXISTS idx_ledger_lines_account
ON public.ledger_lines(account);

-- 3) Driver ledger (immutable, running balance)
CREATE TABLE IF NOT EXISTS public.driver_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reference_type text NOT NULL CHECK (reference_type IN ('order', 'settlement')),
  reference_id text NOT NULL,
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance_after numeric NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_ledger_ref
ON public.driver_ledger(driver_id, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_driver_ledger_driver_time
ON public.driver_ledger(driver_id, occurred_at DESC);

-- 4) COD settlement grouping (supports future batching)
CREATE TABLE IF NOT EXISTS public.cod_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  total_amount numeric NOT NULL CHECK (total_amount > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cod_settlements_driver_time
ON public.cod_settlements(driver_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.cod_settlement_orders (
  settlement_id uuid NOT NULL REFERENCES public.cod_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  PRIMARY KEY (settlement_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_cod_settlement_orders_order_id
ON public.cod_settlement_orders(order_id);

-- 5) Immutability guards
CREATE OR REPLACE FUNCTION public.trg_forbid_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ledger_entries_immutable') THEN
    CREATE TRIGGER trg_ledger_entries_immutable
    BEFORE UPDATE OR DELETE ON public.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.trg_forbid_update_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ledger_lines_immutable') THEN
    CREATE TRIGGER trg_ledger_lines_immutable
    BEFORE UPDATE OR DELETE ON public.ledger_lines
    FOR EACH ROW EXECUTE FUNCTION public.trg_forbid_update_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_driver_ledger_immutable') THEN
    CREATE TRIGGER trg_driver_ledger_immutable
    BEFORE UPDATE OR DELETE ON public.driver_ledger
    FOR EACH ROW EXECUTE FUNCTION public.trg_forbid_update_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cod_settlements_immutable') THEN
    CREATE TRIGGER trg_cod_settlements_immutable
    BEFORE UPDATE OR DELETE ON public.cod_settlements
    FOR EACH ROW EXECUTE FUNCTION public.trg_forbid_update_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cod_settlement_orders_immutable') THEN
    CREATE TRIGGER trg_cod_settlement_orders_immutable
    BEFORE UPDATE OR DELETE ON public.cod_settlement_orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_forbid_update_delete();
  END IF;
END $$;

-- 6) RLS policies (accounting.view/accounting.manage only)
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_settlement_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_entries_select ON public.ledger_entries;
CREATE POLICY ledger_entries_select
ON public.ledger_entries
FOR SELECT
USING (public.has_admin_permission('accounting.view'));

DROP POLICY IF EXISTS ledger_entries_write ON public.ledger_entries;
CREATE POLICY ledger_entries_write
ON public.ledger_entries
FOR INSERT
WITH CHECK (public.has_admin_permission('accounting.manage') OR public.is_admin());

DROP POLICY IF EXISTS ledger_lines_select ON public.ledger_lines;
CREATE POLICY ledger_lines_select
ON public.ledger_lines
FOR SELECT
USING (public.has_admin_permission('accounting.view'));

DROP POLICY IF EXISTS ledger_lines_write ON public.ledger_lines;
CREATE POLICY ledger_lines_write
ON public.ledger_lines
FOR INSERT
WITH CHECK (public.has_admin_permission('accounting.manage') OR public.is_admin());

DROP POLICY IF EXISTS driver_ledger_select ON public.driver_ledger;
CREATE POLICY driver_ledger_select
ON public.driver_ledger
FOR SELECT
USING (public.has_admin_permission('accounting.view'));

DROP POLICY IF EXISTS driver_ledger_write ON public.driver_ledger;
CREATE POLICY driver_ledger_write
ON public.driver_ledger
FOR INSERT
WITH CHECK (public.has_admin_permission('accounting.manage') OR public.is_admin());

DROP POLICY IF EXISTS cod_settlements_select ON public.cod_settlements;
CREATE POLICY cod_settlements_select
ON public.cod_settlements
FOR SELECT
USING (public.has_admin_permission('accounting.view'));

DROP POLICY IF EXISTS cod_settlements_write ON public.cod_settlements;
CREATE POLICY cod_settlements_write
ON public.cod_settlements
FOR INSERT
WITH CHECK (public.has_admin_permission('accounting.manage') OR public.is_admin());

DROP POLICY IF EXISTS cod_settlement_orders_select ON public.cod_settlement_orders;
CREATE POLICY cod_settlement_orders_select
ON public.cod_settlement_orders
FOR SELECT
USING (public.has_admin_permission('accounting.view'));

DROP POLICY IF EXISTS cod_settlement_orders_write ON public.cod_settlement_orders;
CREATE POLICY cod_settlement_orders_write
ON public.cod_settlement_orders
FOR INSERT
WITH CHECK (public.has_admin_permission('accounting.manage') OR public.is_admin());

-- 7) Helpers: COD detection and driver balance
CREATE OR REPLACE FUNCTION public._is_cod_delivery_order(p_order jsonb, p_delivery_zone_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select
    coalesce(nullif(p_order->>'paymentMethod',''), '') = 'cash'
    and coalesce(nullif(p_order->>'orderSource',''), '') <> 'in_store'
    and p_delivery_zone_id is not null
$$;

CREATE OR REPLACE FUNCTION public._driver_ledger_next_balance(
  p_driver_id uuid,
  p_debit numeric,
  p_credit numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev numeric := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_driver_id::text, 0));
  SELECT dl.balance_after
  INTO v_prev
  FROM public.driver_ledger dl
  WHERE dl.driver_id = p_driver_id
  ORDER BY dl.occurred_at DESC, dl.created_at DESC, dl.id DESC
  LIMIT 1;
  RETURN coalesce(v_prev, 0) + coalesce(p_debit, 0) - coalesce(p_credit, 0);
END;
$$;

-- 8) COD delivery posting: recognize revenue + move cash into transit + create driver receivable
CREATE OR REPLACE FUNCTION public.cod_post_delivery(
  p_order_id uuid,
  p_driver_id uuid,
  p_occurred_at timestamptz default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_amount numeric;
  v_at timestamptz;
  v_entry_id uuid;
  v_balance numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;
  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'p_driver_id is required';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_amount := coalesce(nullif((v_order.data->>'total')::numeric, null), 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid order total';
  END IF;

  v_at := coalesce(p_occurred_at, now());

  -- idempotent: one delivery entry per order
  SELECT le.id
  INTO v_entry_id
  FROM public.ledger_entries le
  WHERE le.entry_type = 'delivery'
    AND le.reference_type = 'order'
    AND le.reference_id = p_order_id::text
  LIMIT 1;

  IF v_entry_id IS NULL THEN
    INSERT INTO public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
    VALUES (
      'delivery',
      'order',
      p_order_id::text,
      v_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text, 'driverId', p_driver_id::text, 'amount', v_amount)
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO public.ledger_lines(entry_id, account, debit, credit)
    VALUES
      -- Accrual recognition at delivery
      (v_entry_id, 'Accounts_Receivable_COD', v_amount, 0),
      (v_entry_id, 'Sales_Revenue', 0, v_amount),
      -- Cash collected from customer but still outside cashbox
      (v_entry_id, 'Cash_In_Transit', v_amount, 0),
      (v_entry_id, 'Accounts_Receivable_COD', 0, v_amount);
  END IF;

  -- Driver wallet/receivable (cash in hand with driver)
  v_balance := public._driver_ledger_next_balance(p_driver_id, v_amount, 0);
  INSERT INTO public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  VALUES (p_driver_id, 'order', p_order_id::text, v_amount, 0, v_balance, v_at, auth.uid())
  ON CONFLICT (driver_id, reference_type, reference_id) DO NOTHING;
END;
$$;

-- 9) COD settlement posting: move cash into cashbox, record payment in shift, and set paidAt
CREATE OR REPLACE FUNCTION public.cod_settle_order(
  p_order_id uuid,
  p_occurred_at timestamptz default null
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_data jsonb;
  v_amount numeric;
  v_at timestamptz;
  v_driver_id uuid;
  v_shift_id uuid;
  v_settlement_id uuid;
  v_entry_id uuid;
  v_balance numeric;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_admin_permission('accounting.manage')) THEN
    RAISE EXCEPTION 'not authorized to post accounting entries';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;

  v_at := coalesce(p_occurred_at, now());

  SELECT s.id
  INTO v_shift_id
  FROM public.cash_shifts s
  WHERE s.cashier_id = auth.uid()
    AND coalesce(s.status, 'open') = 'open'
  ORDER BY s.opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'cash method requires an open cash shift';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid order total';
  END IF;

  IF v_order.status::text <> 'delivered' THEN
    RAISE EXCEPTION 'order must be delivered first';
  END IF;

  IF NOT public._is_cod_delivery_order(v_data, v_order.delivery_zone_id) THEN
    RAISE EXCEPTION 'order is not COD delivery';
  END IF;

  IF nullif(v_data->>'paidAt','') IS NOT NULL THEN
    RETURN (v_data->>'paidAt')::timestamptz;
  END IF;

  v_driver_id := nullif(v_data->>'deliveredBy','')::uuid;
  IF v_driver_id IS NULL THEN
    v_driver_id := nullif(v_data->>'assignedDeliveryUserId','')::uuid;
  END IF;
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id is required for COD settlement';
  END IF;

  -- Ensure delivery ledger exists (idempotent creation)
  PERFORM public.cod_post_delivery(p_order_id, v_driver_id, coalesce(nullif(v_data->>'deliveredAt','')::timestamptz, v_at));

  INSERT INTO public.cod_settlements(driver_id, shift_id, total_amount, occurred_at, created_by, data)
  VALUES (v_driver_id, v_shift_id, v_amount, v_at, auth.uid(), jsonb_build_object('orderId', p_order_id::text))
  RETURNING id INTO v_settlement_id;

  INSERT INTO public.cod_settlement_orders(settlement_id, order_id, amount)
  VALUES (v_settlement_id, p_order_id, v_amount);

  INSERT INTO public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
  VALUES (
    'settlement',
    'settlement',
    v_settlement_id::text,
    v_at,
    auth.uid(),
    jsonb_build_object('orderId', p_order_id::text, 'driverId', v_driver_id::text, 'shiftId', v_shift_id::text, 'amount', v_amount)
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.ledger_lines(entry_id, account, debit, credit)
  VALUES
    (v_entry_id, 'Cash_On_Hand', v_amount, 0),
    (v_entry_id, 'Cash_In_Transit', 0, v_amount);

  v_balance := public._driver_ledger_next_balance(v_driver_id, 0, v_amount);
  INSERT INTO public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  VALUES (v_driver_id, 'settlement', v_settlement_id::text, 0, v_amount, v_balance, v_at, auth.uid());

  -- Create payment (cashbox event) inside the cashier shift (creates journal entry too)
  PERFORM public.record_order_payment(
    p_order_id,
    v_amount,
    'cash',
    v_at,
    'cod_settle:' || v_settlement_id::text
  );

  -- Only now: mark paidAt in orders.data
  v_data := jsonb_set(v_data, '{paidAt}', to_jsonb(v_at::text), true);
  UPDATE public.orders
  SET data = v_data,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION public.cod_post_delivery(uuid, uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.cod_post_delivery(uuid, uuid, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.cod_settle_order(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.cod_settle_order(uuid, timestamptz) TO authenticated;

-- 10) Views / Queries for monitoring & audit
CREATE OR REPLACE VIEW public.v_cash_in_transit_balance AS
SELECT
  coalesce(sum(case when ll.account = 'Cash_In_Transit' then (ll.debit - ll.credit) else 0 end), 0) as cash_in_transit_balance
FROM public.ledger_lines ll;

CREATE OR REPLACE VIEW public.v_driver_ledger_balances AS
SELECT
  dl.driver_id,
  max(dl.occurred_at) as last_occurred_at,
  (array_agg(dl.balance_after ORDER BY dl.occurred_at DESC, dl.created_at DESC, dl.id DESC))[1] as balance_after
FROM public.driver_ledger dl
GROUP BY dl.driver_id;

CREATE OR REPLACE VIEW public.v_cod_reconciliation_check AS
SELECT
  (SELECT cash_in_transit_balance FROM public.v_cash_in_transit_balance) as cash_in_transit_balance,
  coalesce((SELECT sum(balance_after) FROM public.v_driver_ledger_balances), 0) as sum_driver_balances,
  ((SELECT cash_in_transit_balance FROM public.v_cash_in_transit_balance) - coalesce((SELECT sum(balance_after) FROM public.v_driver_ledger_balances), 0)) as diff;

CREATE OR REPLACE FUNCTION public.get_cod_audit(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_payments jsonb;
  v_delivery_entry jsonb;
  v_settlements jsonb;
BEGIN
  IF NOT public.has_admin_permission('accounting.view') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.occurred_at), '[]'::jsonb)
  INTO v_payments
  FROM public.payments p
  WHERE p.reference_table = 'orders'
    AND p.reference_id = p_order_id::text
    AND p.direction = 'in';

  SELECT to_jsonb(le)
  INTO v_delivery_entry
  FROM public.ledger_entries le
  WHERE le.entry_type = 'delivery'
    AND le.reference_type = 'order'
    AND le.reference_id = p_order_id::text
  LIMIT 1;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'settlement', to_jsonb(cs),
      'ledgerEntry', to_jsonb(le),
      'orders', (select coalesce(jsonb_agg(to_jsonb(cso)), '[]'::jsonb) from public.cod_settlement_orders cso where cso.settlement_id = cs.id)
    )
    ORDER BY cs.occurred_at
  ), '[]'::jsonb)
  INTO v_settlements
  FROM public.cod_settlements cs
  LEFT JOIN public.ledger_entries le
    ON le.entry_type = 'settlement' AND le.reference_type = 'settlement' AND le.reference_id = cs.id::text
  WHERE EXISTS (
    SELECT 1 FROM public.cod_settlement_orders cso
    WHERE cso.settlement_id = cs.id AND cso.order_id = p_order_id
  );

  RETURN json_build_object(
    'order', jsonb_build_object('id', v_order.id, 'status', v_order.status, 'data', v_order.data, 'delivery_zone_id', v_order.delivery_zone_id),
    'payments_in', v_payments,
    'delivery_ledger_entry', v_delivery_entry,
    'settlements', v_settlements,
    'cit_balance', (SELECT cash_in_transit_balance FROM public.v_cash_in_transit_balance),
    'reconciliation', (SELECT row_to_json(x) FROM (SELECT * FROM public.v_cod_reconciliation_check) x)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cod_audit(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_cod_audit(uuid) TO authenticated;

-- 11) Patch confirm_order_delivery: strip paidAt for COD and post COD delivery ledger
CREATE OR REPLACE FUNCTION public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb,
    p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order record;
    v_order_data jsonb;
    v_promos jsonb;
    v_promos_fixed jsonb := '[]'::jsonb;
    v_line jsonb;
    v_snapshot jsonb;
    v_items_all jsonb := '[]'::jsonb;
    v_item jsonb;
    v_final_data jsonb;
    v_is_cod boolean := false;
    v_driver_id uuid;
    v_delivered_at timestamptz;
BEGIN
    IF p_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'warehouse_id is required';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order not found';
    END IF;

    v_order_data := coalesce(v_order.data, '{}'::jsonb);

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
      p_items := '[]'::jsonb;
    END IF;

    v_items_all := p_items;

    v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
    IF jsonb_typeof(v_promos) = 'array' AND jsonb_array_length(v_promos) > 0 THEN
      IF nullif(btrim(coalesce(v_order_data->>'appliedCouponCode', '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'promotion_coupon_conflict';
      END IF;
      IF coalesce(nullif((v_order_data->>'pointsRedeemedValue')::numeric, null), 0) > 0 THEN
        RAISE EXCEPTION 'promotion_points_conflict';
      END IF;

      FOR v_line IN SELECT value FROM jsonb_array_elements(v_promos)
      LOOP
        v_snapshot := public._compute_promotion_snapshot(
          (v_line->>'promotionId')::uuid,
          null,
          p_warehouse_id,
          coalesce(nullif((v_line->>'bundleQty')::numeric, null), 1),
          null,
          true
        );
        v_snapshot := v_snapshot || jsonb_build_object('promotionLineId', v_line->>'promotionLineId');
        v_promos_fixed := v_promos_fixed || v_snapshot;

        FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb))
        LOOP
          v_items_all := v_items_all || jsonb_build_object(
            'itemId', v_item->>'itemId',
            'quantity', coalesce(nullif((v_item->>'quantity')::numeric, null), 0)
          );
        END LOOP;

        INSERT INTO public.promotion_usage(
          promotion_id,
          promotion_line_id,
          order_id,
          bundle_qty,
          channel,
          warehouse_id,
          snapshot,
          created_by
        )
        VALUES (
          (v_snapshot->>'promotionId')::uuid,
          (v_snapshot->>'promotionLineId')::uuid,
          p_order_id,
          coalesce(nullif((v_snapshot->>'bundleQty')::numeric, null), 1),
          'in_store',
          p_warehouse_id,
          v_snapshot,
          auth.uid()
        )
        ON CONFLICT (promotion_line_id) DO NOTHING;
      END LOOP;

      v_items_all := public._merge_stock_items(v_items_all);
    ELSE
      v_items_all := public._merge_stock_items(v_items_all);
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements im
      WHERE im.reference_table = 'orders'
        AND im.reference_id = p_order_id::text
        AND im.movement_type = 'sale_out'
    ) THEN
      UPDATE public.orders
      SET status = 'delivered',
          data = p_updated_data,
          updated_at = now()
      WHERE id = p_order_id;
      RETURN;
    END IF;

    PERFORM public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);

    v_final_data := coalesce(p_updated_data, v_order_data);
    IF jsonb_array_length(v_promos_fixed) > 0 THEN
      v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos_fixed, true);
    END IF;

    v_is_cod := public._is_cod_delivery_order(v_order_data, v_order.delivery_zone_id);
    IF v_is_cod THEN
      -- prevent early paidAt from client-provided payloads
      v_final_data := v_final_data - 'paidAt';
      v_driver_id := nullif(v_final_data->>'deliveredBy','')::uuid;
      IF v_driver_id IS NULL THEN
        v_driver_id := nullif(v_final_data->>'assignedDeliveryUserId','')::uuid;
      END IF;
      IF v_driver_id IS NOT NULL THEN
        v_delivered_at := coalesce(nullif(v_final_data->>'deliveredAt','')::timestamptz, now());
        PERFORM public.cod_post_delivery(p_order_id, v_driver_id, v_delivered_at);
      END IF;
    END IF;

    UPDATE public.orders
    SET status = 'delivered',
        data = v_final_data,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) TO authenticated;
