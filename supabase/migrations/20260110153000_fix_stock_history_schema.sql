-- 4. Fix stock_history table if missing quantity column (Schema Drift Fix)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_history' AND column_name = 'quantity') THEN
        ALTER TABLE public.stock_history ADD COLUMN quantity numeric;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_history' AND column_name = 'unit') THEN
        ALTER TABLE public.stock_history ADD COLUMN unit text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_history' AND column_name = 'reason') THEN
        ALTER TABLE public.stock_history ADD COLUMN reason text;
    END IF;
END $$;
