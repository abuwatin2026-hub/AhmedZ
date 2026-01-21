WITH ranked AS (
  SELECT
    id,
    reference_number,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY reference_number ORDER BY created_at ASC, id ASC) AS rn
  FROM public.purchase_orders
  WHERE reference_number IS NOT NULL
)
UPDATE public.purchase_orders po
SET reference_number = NULL
FROM ranked r
WHERE po.id = r.id
  AND r.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_reference_number_unique
  ON public.purchase_orders(reference_number)
  WHERE reference_number IS NOT NULL;
