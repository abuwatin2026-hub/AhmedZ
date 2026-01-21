CREATE TABLE IF NOT EXISTS public.expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    amount numeric NOT NULL CHECK (amount > 0),
    category text NOT NULL, -- 'rent', 'salary', 'utilities', 'marketing', 'maintenance', 'other'
    date date NOT NULL DEFAULT CURRENT_DATE,
    notes text,
    created_at timestamptz DEFAULT NOW(),
    created_by uuid REFERENCES auth.users(id)
);
-- Enable RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
-- Policies (Allowing full access to authenticated users for now, can refine to admins only if needed)
CREATE POLICY "Enable read access for all users" ON public.expenses FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.expenses FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for users" ON public.expenses FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Enable delete for users" ON public.expenses FOR DELETE USING (auth.role() = 'authenticated');
