-- إصلاح وظيفة وترغير الفاتورة: إزالة الحقول غير الموجودة من جدول orders
-- هذه الترحيلة تستبدل وظيفة assign_invoice_number لتجنب استخدام invoice_issued_at و payment_status
-- آمنة لإعادة التشغيل
DO $$
BEGIN
  -- إعادة إنشاء مولد رقم الفاتورة إذا لزم
  CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1000;
  
  CREATE OR REPLACE FUNCTION public.generate_invoice_number()
  RETURNS TEXT
  LANGUAGE plpgsql
  AS $func$
  BEGIN
    RETURN 'INV-' || lpad(nextval('public.invoice_seq')::text, 6, '0');
  END;
  $func$;
END $$;
-- استبدال وظيفة التريغر لتجنّب الأعمدة غير الموجودة
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  -- عيّن رقم الفاتورة فقط عند التوصيل إذا لم يكن معيّنًا مسبقًا
  IF (NEW.status = 'delivered') AND NEW.invoice_number IS NULL THEN
    NEW.invoice_number := public.generate_invoice_number();
    -- لا نضبط invoice_issued_at هنا لأن العمود غير موجود في الجدول
  END IF;
  RETURN NEW;
END;
$func$;
-- إعادة إنشاء التريغر على جدول الطلبات
DROP TRIGGER IF EXISTS trg_assign_invoice_number ON public.orders;
CREATE TRIGGER trg_assign_invoice_number
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();
