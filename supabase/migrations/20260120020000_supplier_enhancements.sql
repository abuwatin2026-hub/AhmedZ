-- Create supplier contracts table
CREATE TABLE supplier_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  contract_number TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payment_terms TEXT CHECK (payment_terms IN ('cash', 'net15', 'net30', 'net45', 'net60', 'custom')),
  payment_terms_custom TEXT,
  delivery_lead_time_days INTEGER,
  minimum_order_amount NUMERIC DEFAULT 0,
  document_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated', 'draft')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create supplier evaluations table
CREATE TABLE supplier_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  period_start DATE,
  period_end DATE,
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  timeliness_score INTEGER CHECK (timeliness_score BETWEEN 1 AND 5),
  pricing_score INTEGER CHECK (pricing_score BETWEEN 1 AND 5),
  communication_score INTEGER CHECK (communication_score BETWEEN 1 AND 5),
  overall_score NUMERIC GENERATED ALWAYS AS (
    (quality_score + timeliness_score + pricing_score + communication_score) / 4.0
  ) STORED,
  notes TEXT,
  recommendation TEXT CHECK (recommendation IN ('maintain', 'improve', 'terminate')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE supplier_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_evaluations ENABLE ROW LEVEL SECURITY;

-- Policies for supplier_contracts
CREATE POLICY supplier_contracts_select ON supplier_contracts FOR SELECT USING (true);
CREATE POLICY supplier_contracts_manage ON supplier_contracts FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
);

-- Policies for supplier_evaluations
CREATE POLICY supplier_evaluations_select ON supplier_evaluations FOR SELECT USING (true);
CREATE POLICY supplier_evaluations_manage ON supplier_evaluations FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
);

-- Function to check for expiring contracts
CREATE OR REPLACE FUNCTION get_expiring_contracts(days_threshold INTEGER DEFAULT 30)
RETURNS TABLE (
  contract_id UUID,
  supplier_name TEXT,
  end_date DATE,
  days_remaining INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sc.id,
    s.name,
    sc.end_date,
    (sc.end_date - CURRENT_DATE)::INTEGER
  FROM supplier_contracts sc
  JOIN suppliers s ON sc.supplier_id = s.id
  WHERE sc.status = 'active'
    AND sc.end_date <= (CURRENT_DATE + days_threshold)
    AND sc.end_date >= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
