-- Create cash_shifts table
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
-- Enable RLS
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
-- Ensure idempotent policy creation
DROP POLICY IF EXISTS "Cashiers can view their own shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cashiers can insert their shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Cashiers can update their own open shifts" ON public.cash_shifts;
-- Policies
CREATE POLICY "Cashiers can view their own shifts" ON public.cash_shifts
    FOR SELECT USING (auth.uid() = cashier_id OR (SELECT role FROM public.admin_users WHERE auth_user_id = auth.uid()) IN ('owner', 'manager'));
CREATE POLICY "Cashiers can insert their shifts" ON public.cash_shifts
    FOR INSERT WITH CHECK (auth.uid() = cashier_id);
CREATE POLICY "Cashiers can update their own open shifts" ON public.cash_shifts
    FOR UPDATE USING (auth.uid() = cashier_id AND status = 'open');
-- Add indexes
CREATE INDEX IF NOT EXISTS idx_cash_shifts_cashier_id ON public.cash_shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON public.cash_shifts(status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened_at ON public.cash_shifts(opened_at);
