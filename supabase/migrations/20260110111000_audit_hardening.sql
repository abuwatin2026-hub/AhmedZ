-- Audit Hardening Migration

-- 1. Add new columns to system_audit_logs
ALTER TABLE public.system_audit_logs 
ADD COLUMN IF NOT EXISTS risk_level text CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')) DEFAULT 'LOW',
ADD COLUMN IF NOT EXISTS reason_code text;
-- 2. Create Risk Level Calculation Function
CREATE OR REPLACE FUNCTION public.calculate_risk_level(p_table text, p_op text, p_old jsonb, p_new jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  -- DELETE operations are generally High Risk
  IF p_op = 'delete' THEN
    IF p_table IN ('orders', 'stock_management', 'purchase_orders', 'admin_users', 'journal_entries') THEN
        RETURN 'HIGH';
    END IF;
    RETURN 'MEDIUM';
  END IF;

  -- UPDATE operations
  IF p_op = 'update' THEN
    -- Orders: Status Change to Cancelled or Delivered is High/Medium
    IF p_table = 'orders' THEN
        IF (p_new->>'status') = 'cancelled' AND (p_old->>'status') <> 'cancelled' THEN
            RETURN 'HIGH';
        END IF;
        IF (p_new->>'status') = 'delivered' AND (p_old->>'status') <> 'delivered' THEN
            RETURN 'MEDIUM'; -- Delivery is normal but important
        END IF;
        -- Financial tampering check
        IF (p_new->>'total') <> (p_old->>'total') OR (p_new->>'subtotal') <> (p_old->>'subtotal') THEN
            RETURN 'HIGH';
        END IF;
    END IF;

    -- Stock: Quantity changes
    IF p_table = 'stock_management' THEN
        IF (p_new->>'available_quantity') <> (p_old->>'available_quantity') THEN
            RETURN 'MEDIUM'; -- Frequent but important
        END IF;
    END IF;

    -- Auth: Role/Permission changes
    IF p_table = 'admin_users' THEN
         RETURN 'HIGH';
    END IF;
  END IF;

  -- INSERT operations
  IF p_op = 'insert' THEN
     IF p_table IN ('admin_users') THEN
        RETURN 'HIGH';
     END IF;
  END IF;

  RETURN 'LOW';
END;
$$;
-- 3. Update Audit Trigger to include Risk Level and Reason
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text := tg_table_name;
  v_op text := lower(tg_op);
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_record_id text;
  v_changed text[];
  v_changed_filtered text[] := '{}'::text[];
  v_key text;
  v_metadata jsonb;
  v_risk_level text;
  v_reason_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  IF v_table IN ('customers', 'reviews') AND NOT public.is_admin() THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  -- Try to capture reason from session setting (set by app before critical ops)
  -- App should run: set_config('app.audit_reason', 'USER_CANCELLATION', true);
  BEGIN
    v_reason_code := current_setting('app.audit_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_reason_code := NULL;
  END;

  v_metadata := jsonb_build_object(
    'table', v_table,
    'op', v_op
  );

  IF tg_op = 'INSERT' THEN
    v_new := to_jsonb(new);
    v_row := v_new;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'new_values', v_new);
    v_risk_level := public.calculate_risk_level(v_table, v_op, NULL, v_new);
  
  ELSIF tg_op = 'UPDATE' THEN
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    
    v_changed := public.audit_changed_columns(v_old, v_new);
    
    IF v_changed IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_changed LOOP
        IF v_key NOT IN ('updated_at', 'created_at', 'last_updated') THEN
          v_changed_filtered := array_append(v_changed_filtered, v_key);
        END IF;
      END LOOP;
    END IF;

    IF array_length(v_changed_filtered, 1) IS NULL THEN
      RETURN new;
    END IF;

    v_metadata := v_metadata || jsonb_build_object(
        'recordId', v_record_id, 
        'changedColumns', v_changed_filtered,
        'old_values', v_old,
        'new_values', v_new
    );
    v_risk_level := public.calculate_risk_level(v_table, v_op, v_old, v_new);

  ELSE -- DELETE
    v_old := to_jsonb(old);
    v_row := v_old;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'old_values', v_old);
    v_risk_level := public.calculate_risk_level(v_table, v_op, v_old, NULL);
  END IF;

  -- Enforce Reason Code for HIGH risk operations if missing (Soft Check for now to avoid breakage, but logs warning)
  IF v_risk_level = 'HIGH' AND v_reason_code IS NULL THEN
     v_reason_code := 'MISSING_REASON';
     -- In strict mode, we would: RAISE EXCEPTION 'Reason code is required for high risk operations';
  END IF;

  INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  VALUES (
    v_table || '.' || v_op,
    public.audit_table_module(v_table),
    jsonb_build_object(
      'recordId', v_record_id,
      'changedColumns', v_changed_filtered,
      'risk', v_risk_level
    )::text,
    auth.uid(),
    now(),
    v_metadata,
    v_risk_level,
    v_reason_code
  );

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$$;
-- 4. Make Audit Logs Append-Only (Prevent Tampering)
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Modification of audit logs is strictly prohibited.';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_audit_logs ON public.system_audit_logs;
CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON public.system_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();
-- 5. Helper to set reason code easily from client (exposed as RPC)
CREATE OR REPLACE FUNCTION public.set_audit_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.audit_reason', p_reason, true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_audit_reason(text) TO authenticated;
