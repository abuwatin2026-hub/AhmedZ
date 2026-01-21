-- Update audit_table_module to include purchase_orders and stock_management
CREATE OR REPLACE FUNCTION public.audit_table_module(p_table text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  CASE p_table
    WHEN 'admin_users' THEN RETURN 'auth';
    WHEN 'customers' THEN RETURN 'customers';
    WHEN 'menu_items' THEN RETURN 'inventory';
    WHEN 'addons' THEN RETURN 'inventory';
    WHEN 'stock_management' THEN RETURN 'inventory';
    WHEN 'purchase_orders' THEN RETURN 'purchasing';
    WHEN 'purchase_items' THEN RETURN 'purchasing';
    WHEN 'delivery_zones' THEN RETURN 'orders';
    WHEN 'orders' THEN RETURN 'orders';
    WHEN 'coupons' THEN RETURN 'orders';
    WHEN 'ads' THEN RETURN 'marketing';
    WHEN 'challenges' THEN RETURN 'marketing';
    WHEN 'app_settings' THEN RETURN 'settings';
    WHEN 'item_categories' THEN RETURN 'inventory';
    WHEN 'unit_types' THEN RETURN 'inventory';
    WHEN 'freshness_levels' THEN RETURN 'inventory';
    WHEN 'banks' THEN RETURN 'settings';
    WHEN 'transfer_recipients' THEN RETURN 'settings';
    WHEN 'reviews' THEN RETURN 'reviews';
    ELSE
      RETURN 'system';
  END CASE;
END;
$$;
-- Update audit_get_record_id to include purchase_orders and stock_management
CREATE OR REPLACE FUNCTION public.audit_get_record_id(p_table text, p_row jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    WHEN 'admin_users' THEN RETURN p_row->>'auth_user_id';
    WHEN 'customers' THEN RETURN p_row->>'auth_user_id';
    WHEN 'orders' THEN RETURN p_row->>'id';
    WHEN 'menu_items' THEN RETURN p_row->>'id';
    WHEN 'stock_management' THEN RETURN p_row->>'item_id';
    WHEN 'purchase_orders' THEN RETURN p_row->>'id';
    WHEN 'purchase_items' THEN RETURN p_row->>'id';
    WHEN 'addons' THEN RETURN p_row->>'id';
    WHEN 'delivery_zones' THEN RETURN p_row->>'id';
    WHEN 'coupons' THEN RETURN p_row->>'id';
    WHEN 'ads' THEN RETURN p_row->>'id';
    WHEN 'challenges' THEN RETURN p_row->>'id';
    WHEN 'app_settings' THEN RETURN p_row->>'id';
    WHEN 'item_categories' THEN RETURN p_row->>'id';
    WHEN 'unit_types' THEN RETURN p_row->>'id';
    WHEN 'freshness_levels' THEN RETURN p_row->>'id';
    WHEN 'banks' THEN RETURN p_row->>'id';
    WHEN 'transfer_recipients' THEN RETURN p_row->>'id';
    WHEN 'reviews' THEN RETURN p_row->>'id';
    ELSE
      IF (p_row ? 'id') THEN RETURN p_row->>'id'; END IF;
      RETURN NULL;
  END CASE;
END;
$$;
-- Enhance audit_row_change to capture full old/new values in metadata
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
BEGIN
  IF auth.uid() IS NULL THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  IF v_table IN ('customers', 'reviews') AND NOT public.is_admin() THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  v_metadata := jsonb_build_object(
    'table', v_table,
    'op', v_op
  );

  IF tg_op = 'INSERT' THEN
    v_new := to_jsonb(new);
    v_row := v_new;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'new_values', v_new);
  
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

  ELSE -- DELETE
    v_old := to_jsonb(old);
    v_row := v_old;
    v_record_id := public.audit_get_record_id(v_table, v_row);
    v_metadata := v_metadata || jsonb_build_object('recordId', v_record_id, 'old_values', v_old);
  END IF;

  INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  VALUES (
    v_table || '.' || v_op,
    public.audit_table_module(v_table),
    jsonb_build_object(
      'recordId', v_record_id,
      'changedColumns', v_changed_filtered
    )::text,
    auth.uid(),
    now(),
    v_metadata
  );

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$$;
-- Add triggers for Orders
DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
CREATE TRIGGER trg_audit_orders
AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
-- Add triggers for Stock Management
DROP TRIGGER IF EXISTS trg_audit_stock_management ON public.stock_management;
CREATE TRIGGER trg_audit_stock_management
AFTER INSERT OR UPDATE OR DELETE ON public.stock_management
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
-- Add triggers for Purchase Orders
DROP TRIGGER IF EXISTS trg_audit_purchase_orders ON public.purchase_orders;
CREATE TRIGGER trg_audit_purchase_orders
AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
