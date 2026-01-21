-- Deduplicate supplier records to allow unique indexes
WITH to_keep AS (
  SELECT
    id,
    phone,
    email,
    tax_number,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC, id ASC)  AS rn_phone,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at ASC, id ASC)  AS rn_email,
    ROW_NUMBER() OVER (PARTITION BY tax_number ORDER BY created_at ASC, id ASC) AS rn_tax
  FROM public.suppliers
)
DELETE FROM public.suppliers s
USING to_keep tk
WHERE s.id = tk.id
  AND (
    (tk.phone IS NOT NULL AND tk.rn_phone > 1) OR
    (tk.email IS NOT NULL AND tk.rn_email > 1) OR
    (tk.tax_number IS NOT NULL AND tk.rn_tax > 1)
  );
-- Replace previous non-unique indexes with unique ones (NULLs allowed)
DO $$
BEGIN
  BEGIN
    DROP INDEX IF EXISTS public.idx_suppliers_phone;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
  BEGIN
    DROP INDEX IF EXISTS public.idx_suppliers_email;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
  BEGIN
    DROP INDEX IF EXISTS public.idx_suppliers_tax;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_phone
  ON public.suppliers(phone)
  WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_email
  ON public.suppliers(email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tax
  ON public.suppliers(tax_number)
  WHERE tax_number IS NOT NULL;
