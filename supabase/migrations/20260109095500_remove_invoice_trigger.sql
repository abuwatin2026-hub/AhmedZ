-- إزالة التريغر/الدالة التي تسبب خطأ "record 'new' has no field 'invoice_number'"
-- لأن بعض البيئات لا تحتوي على العمود invoice_number في جدول orders.
-- نعتمد على منطق الواجهة الأمامية لإصدار الفاتورة بدلاً من التريغر.

DO $$
BEGIN
  -- إسقاط التريغر إن وجد
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_assign_invoice_number'
  ) THEN
    DROP TRIGGER trg_assign_invoice_number ON public.orders;
  END IF;
EXCEPTION WHEN others THEN
  -- نتجاهل الأخطاء لضمان التشغيل الآمن
  PERFORM NULL;
END $$;
DO $$
BEGIN
  -- إسقاط الدالة إن وجدت
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'assign_invoice_number'
      AND pg_function_is_visible(oid)
  ) THEN
    DROP FUNCTION public.assign_invoice_number();
  END IF;
EXCEPTION WHEN others THEN
  PERFORM NULL;
END $$;
