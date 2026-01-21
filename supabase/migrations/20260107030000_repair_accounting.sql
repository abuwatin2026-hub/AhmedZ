-- Repair Accounting Tables and Policies
-- Run this script in the Supabase SQL Editor to resolve "Relation does not exist" and RLS errors.

-- 1. Ensure admin_users exists (It should, but just in case)
CREATE TABLE IF NOT EXISTS public.admin_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  email text,
  phone_number text,
  avatar_url text,
  role text not null check (role in ('owner','manager','employee','delivery')),
  permissions text[] null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 2. Cash Shifts
CREATE TABLE IF NOT EXISTS public.cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cashier_id UUID NOT NULL REFERENCES auth.users(id),
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    start_amount NUMERIC DEFAULT 0,
    end_amount NUMERIC,
    expected_amount NUMERIC,
    difference NUMERIC,
    status TEXT CHECK (status IN ('open', 'closed')) DEFAULT 'open',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cash_shifts_cashier_id ON public.cash_shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON public.cash_shifts(status);
-- 3. Suppliers
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
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
-- 4. Purchase Orders
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
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
-- 5. Purchase Items
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES public.menu_items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
-- 6. Expenses
CREATE TABLE IF NOT EXISTS public.expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    amount numeric NOT NULL CHECK (amount > 0),
    category text NOT NULL,
    date date NOT NULL DEFAULT CURRENT_DATE,
    notes text,
    created_at timestamptz DEFAULT NOW(),
    created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
-- 7. Cost Breakdown Columns (Idempotent)
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.menu_items ADD COLUMN buying_price numeric DEFAULT 0;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
    BEGIN
        ALTER TABLE public.menu_items ADD COLUMN transport_cost numeric DEFAULT 0;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
    BEGIN
        ALTER TABLE public.menu_items ADD COLUMN supply_tax_cost numeric DEFAULT 0;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
END $$;
-- 8. RESET POLICIES (Drop all to ensure clean slate)
DO $$
BEGIN
    -- Cash Shifts Policies
    DROP POLICY IF EXISTS "Cashiers can view their own shifts" ON public.cash_shifts;
    DROP POLICY IF EXISTS "Cashiers can insert their shifts" ON public.cash_shifts;
    DROP POLICY IF EXISTS "Cashiers can update their own open shifts" ON public.cash_shifts;
    DROP POLICY IF EXISTS "Admins can view all shifts" ON public.cash_shifts;

    -- Suppliers Policies
    DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.suppliers;
    DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.suppliers;

    -- Purchase Orders Policies
    DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_orders;
    DROP POLICY IF EXISTS "Enable insert/update for admins and managers" ON public.purchase_orders;

    -- Purchase Items Policies
    DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_items;
    DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.purchase_items;

    -- Expenses Policies
    DROP POLICY IF EXISTS "Enable read access for all users" ON public.expenses;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.expenses;
    DROP POLICY IF EXISTS "Enable update for users" ON public.expenses;
    DROP POLICY IF EXISTS "Enable delete for users" ON public.expenses;
    DROP POLICY IF EXISTS "Manage expenses for admins" ON public.expenses;
END $$;
-- 9. RE-CREATE POLICIES (Correctly referencing public.admin_users)

-- Cash Shifts
CREATE POLICY "Cashiers can view their own shifts" ON public.cash_shifts
    FOR SELECT USING (auth.uid() = cashier_id OR (SELECT role FROM public.admin_users WHERE auth_user_id = auth.uid()) IN ('owner', 'manager'));
CREATE POLICY "Cashiers can insert their shifts" ON public.cash_shifts
    FOR INSERT WITH CHECK (auth.uid() = cashier_id);
CREATE POLICY "Cashiers can update their own open shifts" ON public.cash_shifts
    FOR UPDATE USING (auth.uid() = cashier_id AND status = 'open');
-- Suppliers
CREATE POLICY "Enable read access for authenticated users" ON public.suppliers
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for admins and managers" ON public.suppliers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Purchase Orders
CREATE POLICY "Enable read access for authenticated users" ON public.purchase_orders
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert/update for admins and managers" ON public.purchase_orders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Purchase Items
CREATE POLICY "Enable read access for authenticated users" ON public.purchase_items
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for admins and managers" ON public.purchase_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
-- Expenses
CREATE POLICY "Manage expenses for admins" ON public.expenses
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role IN ('owner', 'manager')
        )
    );
