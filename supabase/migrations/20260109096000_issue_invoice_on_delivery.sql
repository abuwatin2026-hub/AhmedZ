-- إصدار الفاتورة محاسبياً عند انتقال حالة الطلب إلى "تم التوصيل"
-- يعتمد على sequence public.invoice_seq ويكتب بيانات الفاتورة داخل الحقل data فقط
-- دون الاعتماد على أعمدة غير موجودة مثل invoice_number

CREATE OR REPLACE FUNCTION public.issue_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_has_invoice boolean;
  v_invoice text;
  v_issued_at timestamptz;
  v_snapshot jsonb;
  v_subtotal numeric;
  v_discount numeric;
  v_delivery_fee numeric;
  v_total numeric;
  v_tax numeric;
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    v_has_invoice := (NEW.data ? 'invoiceIssuedAt') AND (NEW.data ? 'invoiceNumber');
    IF NOT coalesce(v_has_invoice, false) THEN
      v_invoice := public.generate_invoice_number();
      v_issued_at := coalesce(
        nullif(NEW.data->>'paidAt', '')::timestamptz,
        nullif(NEW.data->>'deliveredAt', '')::timestamptz,
        now()
      );

      v_subtotal := coalesce(nullif((NEW.data->>'subtotal')::numeric, null), 0);
      v_discount := coalesce(nullif((NEW.data->>'discountAmount')::numeric, null), 0);
      v_delivery_fee := coalesce(nullif((NEW.data->>'deliveryFee')::numeric, null), 0);
      v_tax := coalesce(nullif((NEW.data->>'taxAmount')::numeric, null), 0);
      v_total := coalesce(nullif((NEW.data->>'total')::numeric, null), v_subtotal - v_discount + v_delivery_fee + v_tax);

      v_snapshot := jsonb_build_object(
        'issuedAt', to_jsonb(v_issued_at),
        'invoiceNumber', to_jsonb(v_invoice),
        'createdAt', to_jsonb(coalesce(nullif(NEW.data->>'createdAt',''), NEW.created_at::text)),
        'orderSource', to_jsonb(coalesce(nullif(NEW.data->>'orderSource',''), 'online')),
        'items', coalesce(NEW.data->'items', '[]'::jsonb),
        'subtotal', to_jsonb(v_subtotal),
        'deliveryFee', to_jsonb(v_delivery_fee),
        'discountAmount', to_jsonb(v_discount),
        'total', to_jsonb(v_total),
        'paymentMethod', to_jsonb(coalesce(nullif(NEW.data->>'paymentMethod',''), 'cash')),
        'customerName', to_jsonb(coalesce(NEW.data->>'customerName', '')),
        'phoneNumber', to_jsonb(coalesce(NEW.data->>'phoneNumber', '')),
        'address', to_jsonb(coalesce(NEW.data->>'address', '')),
        'deliveryZoneId', CASE WHEN NEW.data ? 'deliveryZoneId' THEN to_jsonb(NEW.data->>'deliveryZoneId') ELSE NULL END
      );

      NEW.data := jsonb_set(NEW.data, '{invoiceNumber}', to_jsonb(v_invoice), true);
      NEW.data := jsonb_set(NEW.data, '{invoiceIssuedAt}', to_jsonb(v_issued_at), true);
      NEW.data := jsonb_set(NEW.data, '{invoiceSnapshot}', v_snapshot, true);
      IF NOT (NEW.data ? 'invoicePrintCount') THEN
        NEW.data := jsonb_set(NEW.data, '{invoicePrintCount}', '0'::jsonb, true);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS trg_issue_invoice_on_delivery ON public.orders;
CREATE TRIGGER trg_issue_invoice_on_delivery
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_invoice_on_delivery();
