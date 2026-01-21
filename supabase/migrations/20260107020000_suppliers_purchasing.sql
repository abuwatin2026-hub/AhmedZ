-- Create suppliers table
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    tax_number TEXT,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Enable RLS for suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_admin_select ON public.suppliers;
DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.suppliers;
CREATE POLICY suppliers_admin_select ON public.suppliers
    FOR SELECT USING (public.is_admin());
CREATE POLICY "Enable all access for admins and managers" ON public.suppliers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
    reference_number TEXT,
    total_amount NUMERIC DEFAULT 0,
    paid_amount NUMERIC DEFAULT 0,
    purchase_date DATE DEFAULT CURRENT_DATE,
    items_count INTEGER DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Enable RLS for purchase_orders
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_admin_select ON public.purchase_orders;
DROP POLICY IF EXISTS "Enable insert/update for admins and managers" ON public.purchase_orders;
CREATE POLICY purchase_orders_admin_select ON public.purchase_orders
    FOR SELECT USING (public.is_admin());
CREATE POLICY "Enable insert/update for admins and managers" ON public.purchase_orders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Create purchase_items table
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES public.menu_items(id), -- Currently linking to menu_items, future: ingredients
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Enable RLS for purchase_items
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_items;
DROP POLICY IF EXISTS purchase_items_admin_select ON public.purchase_items;
DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.purchase_items;
CREATE POLICY purchase_items_admin_select ON public.purchase_items
    FOR SELECT USING (public.is_admin());
CREATE POLICY "Enable all access for admins and managers" ON public.purchase_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON public.purchase_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_item ON public.purchase_items(item_id);
