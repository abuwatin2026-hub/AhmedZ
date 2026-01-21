-- Backfill missing invoices and strengthen zone filter in sales summary
DO $$
BEGIN
  -- Ensure invoice sequence and generator exist
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

-- Backfill invoice_number and invoiceSnapshot (issuedAt, invoiceNumber) for delivered+paid orders missing them
DO $$
DECLARE
  r RECORD;
  v_new_inv TEXT;
  v_issued_at timestamptz;
  v_snapshot jsonb;
BEGIN
  FOR r IN
    SELECT o.id, o.data, o.created_at, o.invoice_number
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND nullif(o.data->>'paidAt','') IS NOT NULL
      AND (
        nullif(o.invoice_number,'') IS NULL
        OR o.data->'invoiceSnapshot' IS NULL
        OR nullif(o.data->'invoiceSnapshot'->>'invoiceNumber','') IS NULL
        OR nullif(o.data->'invoiceSnapshot'->>'issuedAt','') IS NULL
      )
  LOOP
    v_issued_at := coalesce(
      nullif(r.data->'invoiceSnapshot'->>'issuedAt','')::timestamptz,
      nullif(r.data->>'paidAt','')::timestamptz,
      nullif(r.data->>'deliveredAt','')::timestamptz,
      r.created_at
    );

    v_new_inv := coalesce(nullif(r.invoice_number,''), public.generate_invoice_number());

    v_snapshot := coalesce(r.data->'invoiceSnapshot', jsonb_build_object());
    v_snapshot := jsonb_set(v_snapshot, '{issuedAt}', to_jsonb(coalesce(v_issued_at, now())::text), true);
    v_snapshot := jsonb_set(v_snapshot, '{invoiceNumber}', to_jsonb(v_new_inv), true);

    UPDATE public.orders
    SET
      invoice_number = v_new_inv,
      data = jsonb_set(coalesce(data,'{}'::jsonb), '{invoiceSnapshot}', v_snapshot, true)
    WHERE id = r.id;
  END LOOP;
END $$;

-- Replace get_sales_report_summary to include robust zone filter (delivery_zone_id or JSON deliveryZoneId)
DROP FUNCTION IF EXISTS public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean);
CREATE OR REPLACE FUNCTION public.get_sales_report_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid DEFAULT NULL,
  p_invoice_only boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_collected numeric := 0;
  v_total_tax numeric := 0;
  v_total_delivery numeric := 0;
  v_total_discounts numeric := 0;
  v_gross_subtotal numeric := 0;
  v_total_orders integer := 0;
  v_cancelled_orders integer := 0;
  v_delivered_orders integer := 0;
  v_total_returns numeric := 0;
  v_total_cogs numeric := 0;
  v_total_returns_cogs numeric := 0;
  v_total_wastage numeric := 0;
  v_total_expenses numeric := 0;
  v_total_delivery_cost numeric := 0;
  v_out_for_delivery integer := 0;
  v_in_store integer := 0;
  v_online integer := 0;
  v_result json;
BEGIN
  -- Summary totals
  WITH effective_orders AS (
    SELECT
      o.id,
      o.status,
      o.created_at,
      o.delivery_zone_id,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) as tax_amount,
      coalesce(nullif((o.data->>'deliveryFee')::numeric, null), 0) as delivery_fee,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as discount_amount,
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as subtotal,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      CASE
        WHEN p_invoice_only
          THEN nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        ELSE coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      END as date_by,
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
      coalesce(
        o.delivery_zone_id,
        CASE
          WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
               AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (o.data->>'deliveryZoneId')::uuid
          ELSE NULL
        END
      ) AS zone_effective
    FROM public.orders o
    WHERE (p_zone_id IS NULL OR coalesce(
      o.delivery_zone_id,
      CASE
        WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
             AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (o.data->>'deliveryZoneId')::uuid
        ELSE NULL
      END
    ) = p_zone_id)
  )
  SELECT
    coalesce(sum(eo.total), 0),
    coalesce(sum(eo.tax_amount), 0),
    coalesce(sum(eo.delivery_fee), 0),
    coalesce(sum(eo.discount_amount), 0),
    coalesce(sum(eo.subtotal), 0),
    count(*),
    count(*) FILTER (WHERE eo.status = 'delivered')
  INTO
    v_total_collected,
    v_total_tax,
    v_total_delivery,
    v_total_discounts,
    v_gross_subtotal,
    v_total_orders,
    v_delivered_orders
  FROM effective_orders eo
  WHERE eo.status = 'delivered'
    AND eo.paid_at IS NOT NULL
    AND eo.date_by >= p_start_date
    AND eo.date_by <= p_end_date;

  -- Cancelled orders count
  WITH effective_orders AS (
    SELECT
      o.id,
      o.status,
      o.created_at,
      CASE
        WHEN p_invoice_only
          THEN nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        ELSE coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      END as date_by,
      coalesce(
        o.delivery_zone_id,
        CASE
          WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
               AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (o.data->>'deliveryZoneId')::uuid
          ELSE NULL
        END
      ) AS zone_effective
    FROM public.orders o
    WHERE (p_zone_id IS NULL OR coalesce(
      o.delivery_zone_id,
      CASE
        WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
             AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (o.data->>'deliveryZoneId')::uuid
        ELSE NULL
      END
    ) = p_zone_id)
  )
  SELECT count(*)
  INTO v_cancelled_orders
  FROM effective_orders eo
  WHERE eo.status = 'cancelled'
    AND eo.date_by >= p_start_date
    AND eo.date_by <= p_end_date;

  -- Returns total
  SELECT coalesce(sum(sr.total_refund_amount), 0)
  INTO v_total_returns
  FROM public.sales_returns sr
  JOIN public.orders o ON o.id::text = sr.order_id::text
  WHERE sr.status = 'completed'
    AND sr.return_date >= p_start_date
    AND sr.return_date <= p_end_date
    AND (
      p_zone_id IS NULL OR coalesce(
        o.delivery_zone_id,
        CASE
          WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
               AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (o.data->>'deliveryZoneId')::uuid
          ELSE NULL
        END
      ) = p_zone_id
    );

  -- COGS totals (minus returns cogs)
  WITH effective_orders AS (
    SELECT
      o.id,
      o.status,
      o.created_at,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      CASE
        WHEN p_invoice_only
          THEN nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        ELSE coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      END as date_by,
      coalesce(
        o.delivery_zone_id,
        CASE
          WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
               AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (o.data->>'deliveryZoneId')::uuid
          ELSE NULL
        END
      ) AS zone_effective
    FROM public.orders o
    WHERE (p_zone_id IS NULL OR coalesce(
      o.delivery_zone_id,
      CASE
        WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
             AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (o.data->>'deliveryZoneId')::uuid
        ELSE NULL
      END
    ) = p_zone_id)
  )
  SELECT coalesce(sum(oic.total_cost), 0)
  INTO v_total_cogs
  FROM public.order_item_cogs oic
  JOIN effective_orders eo ON oic.order_id = eo.id
  WHERE eo.status = 'delivered'
    AND eo.paid_at IS NOT NULL
    AND eo.date_by >= p_start_date
    AND eo.date_by <= p_end_date;

  SELECT coalesce(sum(im.total_cost), 0)
  INTO v_total_returns_cogs
  FROM public.inventory_movements im
  WHERE im.reference_table = 'sales_returns'
    AND im.movement_type = 'return_in'
    AND im.occurred_at >= p_start_date
    AND im.occurred_at <= p_end_date
    AND (
      p_zone_id IS NULL OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = (im.data->>'orderId')::uuid
          AND coalesce(
            o.delivery_zone_id,
            CASE
              WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
                   AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN (o.data->>'deliveryZoneId')::uuid
              ELSE NULL
            END
          ) = p_zone_id
      )
    );

  v_total_cogs := greatest(v_total_cogs - v_total_returns_cogs, 0);

  -- Wastage and expenses (global only)
  IF p_zone_id IS NULL THEN
    SELECT coalesce(sum(quantity * cost_at_time), 0)
    INTO v_total_wastage
    FROM public.stock_wastage
    WHERE created_at >= p_start_date AND created_at <= p_end_date;

    SELECT coalesce(sum(amount), 0)
    INTO v_total_expenses
    FROM public.expenses
    WHERE date >= p_start_date::date AND date <= p_end_date::date;
  ELSE
    v_total_wastage := 0;
    v_total_expenses := 0;
  END IF;

  -- Delivery costs
  SELECT coalesce(sum(dc.cost_amount), 0)
  INTO v_total_delivery_cost
  FROM public.delivery_costs dc
  WHERE dc.occurred_at >= p_start_date
    AND dc.occurred_at <= p_end_date
    AND (
      p_zone_id IS NULL OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = dc.order_id
          AND coalesce(
            o.delivery_zone_id,
            CASE
              WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
                   AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN (o.data->>'deliveryZoneId')::uuid
              ELSE NULL
            END
          ) = p_zone_id
      )
    );

  -- Out-for-delivery and source counts
  WITH effective_orders AS (
    SELECT
      o.id,
      o.status,
      o.created_at,
      CASE
        WHEN p_invoice_only
          THEN nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        ELSE coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      END as date_by,
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
      coalesce(
        o.delivery_zone_id,
        CASE
          WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
               AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (o.data->>'deliveryZoneId')::uuid
          ELSE NULL
        END
      ) AS zone_effective
    FROM public.orders o
    WHERE (p_zone_id IS NULL OR coalesce(
      o.delivery_zone_id,
      CASE
        WHEN nullif(o.data->>'deliveryZoneId','') IS NOT NULL
             AND (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (o.data->>'deliveryZoneId')::uuid
        ELSE NULL
      END
    ) = p_zone_id)
  )
  SELECT
    coalesce(count(*) FILTER (WHERE status = 'out_for_delivery'), 0),
    coalesce(count(*) FILTER (WHERE status = 'delivered' AND order_source = 'in_store'), 0),
    coalesce(count(*) FILTER (WHERE status = 'delivered' AND order_source <> 'in_store'), 0)
  INTO v_out_for_delivery, v_in_store, v_online
  FROM effective_orders eo
  WHERE eo.date_by >= p_start_date
    AND eo.date_by <= p_end_date;

  v_result := json_build_object(
    'total_collected', v_total_collected,
    'gross_subtotal', v_gross_subtotal,
    'returns', v_total_returns,
    'discounts', v_total_discounts,
    'tax', v_total_tax,
    'delivery_fees', v_total_delivery,
    'delivery_cost', v_total_delivery_cost,
    'cogs', v_total_cogs,
    'wastage', v_total_wastage,
    'expenses', v_total_expenses,
    'total_orders', v_total_orders,
    'delivered_orders', v_delivered_orders,
    'cancelled_orders', v_cancelled_orders,
    'out_for_delivery_count', v_out_for_delivery,
    'in_store_count', v_in_store,
    'online_count', v_online
  );

  RETURN v_result;
END;
$$;
