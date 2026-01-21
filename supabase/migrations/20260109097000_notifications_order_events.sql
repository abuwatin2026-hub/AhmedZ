-- إشعارات متكاملة لإنشاء الطلب وتغيير إسناد المندوب
-- ترسل إشعارًا للعميل عند إنشاء الطلب، وللإداريين بوجود طلب جديد،
-- وترسل إشعارًا للمندوب عند إسناد/إلغاء الإسناد.

CREATE OR REPLACE FUNCTION public.notify_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_title text;
  v_message text;
  v_link text;
  r_admin record;
BEGIN
  v_link := '/order/' || NEW.id::text;
  
  IF NEW.customer_auth_user_id IS NOT NULL THEN
    v_title := 'تم استلام طلبك ✅';
    v_message := 'جارٍ معالجة طلبك رقم #' || substring(NEW.id::text, 1, 6);
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.customer_auth_user_id, v_title, v_message, 'order_update', v_link);
  END IF;
  
  FOR r_admin IN
    SELECT au.auth_user_id
    FROM public.admin_users au
    WHERE au.is_active = true
      AND au.role IN ('owner','manager')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (r_admin.auth_user_id, 'طلب جديد وصل 🧾', 'طلب جديد #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
  END LOOP;
  
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS trg_notify_order_created ON public.orders;
CREATE TRIGGER trg_notify_order_created
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_created();
CREATE OR REPLACE FUNCTION public.notify_delivery_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_old text;
  v_new text;
  v_link text;
BEGIN
  v_old := COALESCE(NULLIF(OLD.data->>'assignedDeliveryUserId',''), NULL);
  v_new := COALESCE(NULLIF(NEW.data->>'assignedDeliveryUserId',''), NULL);
  v_link := '/admin/orders';
  
  IF v_old IS DISTINCT FROM v_new THEN
    IF v_new IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_new::uuid, 'تم إسناد طلب إليك 🛵', 'طلب #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
    END IF;
    IF v_old IS NOT NULL AND v_new IS NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_old::uuid, 'أُلغي إسناد أحد الطلبات', 'طلب #' || substring(NEW.id::text, 1, 6), 'order_update', v_link);
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS trg_notify_delivery_assignment_change ON public.orders;
CREATE TRIGGER trg_notify_delivery_assignment_change
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_assignment_change();
