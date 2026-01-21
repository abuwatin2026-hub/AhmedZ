DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'tax_amount') THEN
        ALTER TABLE public.orders ADD COLUMN tax_amount numeric DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'tax_rate') THEN
        ALTER TABLE public.orders ADD COLUMN tax_rate numeric DEFAULT 0;
    END IF;
END $$;
