-- Comprehensive Audit Logging
-- This migration adds triggers to log all sensitive operations in the system

-- 1. Log menu_items price changes and deletions
CREATE OR REPLACE FUNCTION public.log_menu_item_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_price numeric;
  v_new_price numeric;
  v_old_cost numeric;
  v_new_cost numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Extract prices from JSONB data
    v_old_price := (OLD.data->>'price')::numeric;
    v_new_price := (NEW.data->>'price')::numeric;
    v_old_cost := (OLD.data->>'costPrice')::numeric;
    v_new_cost := (NEW.data->>'costPrice')::numeric;
    
    -- Log price changes
    IF v_old_price IS DISTINCT FROM v_new_price THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'price_change',
        'menu_items',
        concat('Price changed for item "', NEW.data->>'name'->>'ar', '" (', NEW.id, ') from ', COALESCE(v_old_price::text, 'NULL'), ' to ', COALESCE(v_new_price::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', NEW.id,
          'item_name', NEW.data->'name',
          'old_price', v_old_price,
          'new_price', v_new_price,
          'change_amount', COALESCE(v_new_price, 0) - COALESCE(v_old_price, 0)
        )
      );
    END IF;
    
    -- Log cost price changes
    IF v_old_cost IS DISTINCT FROM v_new_cost THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'cost_change',
        'menu_items',
        concat('Cost price changed for item "', NEW.data->>'name'->>'ar', '" (', NEW.id, ') from ', COALESCE(v_old_cost::text, 'NULL'), ' to ', COALESCE(v_new_cost::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', NEW.id,
          'item_name', NEW.data->'name',
          'old_cost', v_old_cost,
          'new_cost', v_new_cost
        )
      );
    END IF;
    
    -- Log status changes
    IF (OLD.data->>'status') IS DISTINCT FROM (NEW.data->>'status') THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'status_change',
        'menu_items',
        concat('Status changed for item "', NEW.data->>'name'->>'ar', '" (', NEW.id, ') from ', OLD.data->>'status', ' to ', NEW.data->>'status'),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', NEW.id,
          'item_name', NEW.data->'name',
          'old_status', OLD.data->>'status',
          'new_status', NEW.data->>'status'
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'delete',
      'menu_items',
      concat('Deleted item "', OLD.data->>'name'->>'ar', '" (', OLD.id, ')'),
      auth.uid(),
      now(),
      jsonb_build_object(
        'item_id', OLD.id,
        'item_name', OLD.data->'name',
        'item_data', OLD.data
      )
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_menu_items_audit ON public.menu_items;
CREATE TRIGGER trg_menu_items_audit
AFTER UPDATE OR DELETE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.log_menu_item_changes();
-- 2. Log customer data changes
CREATE OR REPLACE FUNCTION public.log_customer_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_fields jsonb := '{}'::jsonb;
  v_field text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Track which fields changed
    IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
      v_changed_fields := v_changed_fields || jsonb_build_object('full_name', jsonb_build_object('old', OLD.full_name, 'new', NEW.full_name));
    END IF;
    
    IF OLD.phone_number IS DISTINCT FROM NEW.phone_number THEN
      v_changed_fields := v_changed_fields || jsonb_build_object('phone_number', jsonb_build_object('old', OLD.phone_number, 'new', NEW.phone_number));
    END IF;
    
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      v_changed_fields := v_changed_fields || jsonb_build_object('email', jsonb_build_object('old', OLD.email, 'new', NEW.email));
    END IF;
    
    IF OLD.loyalty_points IS DISTINCT FROM NEW.loyalty_points THEN
      v_changed_fields := v_changed_fields || jsonb_build_object('loyalty_points', jsonb_build_object('old', OLD.loyalty_points, 'new', NEW.loyalty_points, 'change', NEW.loyalty_points - OLD.loyalty_points));
    END IF;
    
    IF OLD.loyalty_tier IS DISTINCT FROM NEW.loyalty_tier THEN
      v_changed_fields := v_changed_fields || jsonb_build_object('loyalty_tier', jsonb_build_object('old', OLD.loyalty_tier, 'new', NEW.loyalty_tier));
    END IF;
    
    -- Only log if something actually changed
    IF v_changed_fields != '{}'::jsonb THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'update',
        'customers',
        concat('Updated customer ', COALESCE(NEW.full_name, NEW.phone_number, NEW.email, NEW.auth_user_id::text)),
        auth.uid(),
        now(),
        jsonb_build_object(
          'customer_id', NEW.auth_user_id,
          'customer_name', NEW.full_name,
          'changed_fields', v_changed_fields
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'delete',
      'customers',
      concat('Deleted customer ', COALESCE(OLD.full_name, OLD.phone_number, OLD.email, OLD.auth_user_id::text)),
      auth.uid(),
      now(),
      jsonb_build_object(
        'customer_id', OLD.auth_user_id,
        'customer_name', OLD.full_name,
        'customer_phone', OLD.phone_number,
        'customer_email', OLD.email
      )
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_customers_audit ON public.customers;
CREATE TRIGGER trg_customers_audit
AFTER UPDATE OR DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.log_customer_changes();
-- 3. Log app_settings changes
CREATE OR REPLACE FUNCTION public.log_settings_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_keys text[];
  v_key text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  -- Find all changed keys in the data JSONB
  SELECT ARRAY_AGG(DISTINCT key)
  INTO v_changed_keys
  FROM (
    SELECT key FROM jsonb_each(NEW.data)
    EXCEPT
    SELECT key FROM jsonb_each(OLD.data)
    UNION
    SELECT key FROM jsonb_each(OLD.data)
    EXCEPT
    SELECT key FROM jsonb_each(NEW.data)
    UNION
    SELECT key FROM jsonb_each(NEW.data)
    WHERE NEW.data->key IS DISTINCT FROM OLD.data->key
  ) changed;
  
  -- Build changes object
  IF v_changed_keys IS NOT NULL THEN
    FOREACH v_key IN ARRAY v_changed_keys
    LOOP
      v_changes := v_changes || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'old', OLD.data->v_key,
          'new', NEW.data->v_key
        )
      );
    END LOOP;
    
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'update',
      'settings',
      concat('Application settings updated (', array_length(v_changed_keys, 1), ' settings changed)'),
      auth.uid(),
      now(),
      jsonb_build_object(
        'changed_settings', v_changed_keys,
        'changes', v_changes
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_settings_audit ON public.app_settings;
CREATE TRIGGER trg_app_settings_audit
AFTER UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.log_settings_changes();
-- 4. Log admin_users permission and role changes
CREATE OR REPLACE FUNCTION public.log_admin_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'create',
      'admin_users',
      concat('Created admin user ', COALESCE(NEW.full_name, NEW.username), ' with role ', NEW.role),
      auth.uid(),
      now(),
      jsonb_build_object(
        'user_id', NEW.auth_user_id,
        'username', NEW.username,
        'full_name', NEW.full_name,
        'role', NEW.role,
        'permissions', NEW.permissions
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log role changes
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'role_change',
        'admin_users',
        concat('Role changed for user ', COALESCE(NEW.full_name, NEW.username), ' from ', OLD.role, ' to ', NEW.role),
        auth.uid(),
        now(),
        jsonb_build_object(
          'user_id', NEW.auth_user_id,
          'username', NEW.username,
          'full_name', NEW.full_name,
          'old_role', OLD.role,
          'new_role', NEW.role
        )
      );
    END IF;
    
    -- Log permission changes
    IF OLD.permissions IS DISTINCT FROM NEW.permissions THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        'permission_change',
        'admin_users',
        concat('Permissions changed for user ', COALESCE(NEW.full_name, NEW.username)),
        auth.uid(),
        now(),
        jsonb_build_object(
          'user_id', NEW.auth_user_id,
          'username', NEW.username,
          'full_name', NEW.full_name,
          'old_permissions', OLD.permissions,
          'new_permissions', NEW.permissions
        )
      );
    END IF;
    
    -- Log activation/deactivation
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      VALUES (
        CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END,
        'admin_users',
        concat(
          CASE WHEN NEW.is_active THEN 'Activated' ELSE 'Deactivated' END,
          ' user ', COALESCE(NEW.full_name, NEW.username)
        ),
        auth.uid(),
        now(),
        jsonb_build_object(
          'user_id', NEW.auth_user_id,
          'username', NEW.username,
          'full_name', NEW.full_name,
          'is_active', NEW.is_active
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'delete',
      'admin_users',
      concat('Deleted admin user ', COALESCE(OLD.full_name, OLD.username)),
      auth.uid(),
      now(),
      jsonb_build_object(
        'user_id', OLD.auth_user_id,
        'username', OLD.username,
        'full_name', OLD.full_name,
        'role', OLD.role,
        'permissions', OLD.permissions
      )
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_admin_users_audit ON public.admin_users;
CREATE TRIGGER trg_admin_users_audit
AFTER INSERT OR UPDATE OR DELETE ON public.admin_users
FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();
-- 5. Log chart of accounts changes
CREATE OR REPLACE FUNCTION public.log_coa_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'create',
      'chart_of_accounts',
      concat('Created account ', NEW.code, ' - ', NEW.name),
      auth.uid(),
      now(),
      jsonb_build_object(
        'account_id', NEW.id,
        'code', NEW.code,
        'name', NEW.name,
        'account_type', NEW.account_type,
        'normal_balance', NEW.normal_balance
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'update',
      'chart_of_accounts',
      concat('Updated account ', NEW.code, ' - ', NEW.name),
      auth.uid(),
      now(),
      jsonb_build_object(
        'account_id', NEW.id,
        'code', NEW.code,
        'old_name', OLD.name,
        'new_name', NEW.name,
        'old_active', OLD.is_active,
        'new_active', NEW.is_active
      )
    );
    
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    VALUES (
      'delete',
      'chart_of_accounts',
      concat('Deleted account ', OLD.code, ' - ', OLD.name),
      auth.uid(),
      now(),
      jsonb_build_object(
        'account_id', OLD.id,
        'code', OLD.code,
        'name', OLD.name
      )
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_coa_audit ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_audit
AFTER INSERT OR UPDATE OR DELETE ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.log_coa_changes();
-- Add indexes for better audit log query performance
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_module_date 
ON public.system_audit_logs(module, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_action_date 
ON public.system_audit_logs(action, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_performed_by 
ON public.system_audit_logs(performed_by, performed_at DESC);
-- Add comments
COMMENT ON FUNCTION public.log_menu_item_changes() IS 'Audit trigger: Logs all price, cost, and status changes for menu items';
COMMENT ON FUNCTION public.log_customer_changes() IS 'Audit trigger: Logs all customer data modifications';
COMMENT ON FUNCTION public.log_settings_changes() IS 'Audit trigger: Logs all application settings changes';
COMMENT ON FUNCTION public.log_admin_changes() IS 'Audit trigger: Logs all admin user role and permission changes';
COMMENT ON FUNCTION public.log_coa_changes() IS 'Audit trigger: Logs all chart of accounts modifications';
