-- Add cost_price to menu_items to track the cost of goods
-- Default to 0 until set by admin
alter table public.menu_items
add column if not exists cost_price numeric not null default 0;
-- Create stock_wastage table to track spoiled/expired items
create table if not exists public.stock_wastage (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null, -- Amount wasted
  unit_type text, -- Snapshot of unit type
  cost_at_time numeric not null, -- Snapshot of cost price at usage time (to calculate loss accurately even if cost changes later)
  reason text, -- e.g. 'expired', 'damaged', 'lost'
  notes text,
  reported_by uuid references auth.users(id) on delete set null, -- Admin who reported it
  created_at timestamptz not null default now()
);
-- Enable RLS
alter table public.stock_wastage enable row level security;
-- Policies for stock_wastage
-- Admins can view and create wastage records
drop policy if exists stock_wastage_admin_all on public.stock_wastage;
create policy stock_wastage_admin_all
on public.stock_wastage
for all
using (public.is_admin())
with check (public.is_admin());
-- Create index for reporting
create index if not exists idx_wastage_item_date on public.stock_wastage(item_id, created_at desc);
create index if not exists idx_wastage_created_at on public.stock_wastage(created_at desc);
