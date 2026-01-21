ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS buying_price numeric DEFAULT 0;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS transport_cost numeric DEFAULT 0;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS supply_tax_cost numeric DEFAULT 0;
