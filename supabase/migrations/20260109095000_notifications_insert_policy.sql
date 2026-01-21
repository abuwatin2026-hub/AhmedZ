CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_title text;
  v_message text;
  v_link text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_link := '/order/' || NEW.id::text;
    CASE NEW.status
      WHEN 'preparing' THEN
        v_title := 'طلبك قيد التحضير 🍳';
        v_message := 'بدأنا في تجهيز طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'out_for_delivery' THEN
        v_title := 'طلبك في الطريق 🛵';
        v_message := 'خرج المندوب لتوصيل طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'delivered' THEN
        v_title := 'تم التوصيل 🎉';
        v_message := 'نتمنى لك تجربة ممتعة! تم توصيل الطلب #' || substring(NEW.id::text, 1, 6);
      WHEN 'cancelled' THEN
        v_title := 'تم إلغاء الطلب ❌';
        v_message := 'عذراً، تم إلغاء طلبك رقم #' || substring(NEW.id::text, 1, 6);
      WHEN 'scheduled' THEN
        v_title := 'تم جدولة الطلب 📅';
        v_message := 'تم تأكيد جدولة طلبك رقم #' || substring(NEW.id::text, 1, 6);
      ELSE
        RETURN NEW;
    END CASE;
    IF NEW.customer_auth_user_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.customer_auth_user_id, v_title, v_message, 'order_update', v_link);
      EXCEPTION WHEN others THEN
        PERFORM NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS trg_notify_order_status ON public.orders;
CREATE TRIGGER trg_notify_order_status
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();
DROP POLICY IF EXISTS notifications_insert_admin ON public.notifications;
CREATE POLICY notifications_insert_admin ON public.notifications
FOR INSERT
WITH CHECK (public.is_admin());
