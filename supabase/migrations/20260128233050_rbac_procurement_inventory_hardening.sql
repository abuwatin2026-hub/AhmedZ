-- RBAC hardening: procurement & inventory policies (no accounting logic changes)
-- 2026-01-28
-- This migration tightens RLS policies to use has_admin_permission(...) instead of is_admin
-- and restricts import shipment close/delivered status changes to owner/manager via 'import.close'.

-- 1) Update has_admin_permission to recognize new permission keys and enforce owner/manager-only for import.close
create or replace function public.has_admin_permission(p text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_perms text[];
begin
  select au.role, au.permissions
  into v_role, v_perms
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_role is null then
    return false;
  end if;

  -- Owners/Managers: full access
  if v_role in ('owner', 'manager') then
    return true;
  end if;

  -- Special hard guard: 'import.close' allowed only for owner/manager
  if p = 'import.close' then
    return false;
  end if;

  -- Explicit permission list assigned to the user
  if v_perms is not null and p = any(v_perms) then
    return true;
  end if;

  -- Role-based defaults (unchanged behavior)
  if v_role = 'cashier' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid',
      'orders.createInStore',
      'cashShifts.open',
      'cashShifts.viewOwn',
      'cashShifts.closeSelf',
      'cashShifts.cashIn',
      'cashShifts.cashOut'
    ]);
  end if;

  if v_role = 'delivery' then
    return p = any(array[
      'profile.view',
      'orders.view',
      'orders.updateStatus.delivery'
    ]);
  end if;

  if v_role = 'employee' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid'
    ]);
  end if;

  if v_role = 'accountant' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'reports.view',
      'expenses.manage',
      'accounting.view',
      'accounting.manage',
      'accounting.periods.close'
    ]);
  end if;

  return false;
end;
$$;

-- 2) Import tables: switch to has_admin_permission('procurement.manage')
do $$
begin
  -- import_shipments
  alter table public.import_shipments enable row level security;
  begin
    drop policy if exists "Admin users can manage import_shipments" on public.import_shipments;
  exception when undefined_object then null;
  end;
  -- General manage policy (disallow setting delivered/closed without 'import.close')
  create policy import_shipments_manage
  on public.import_shipments
  for all
  using (public.has_admin_permission('procurement.manage'))
  with check (
    public.has_admin_permission('procurement.manage')
    and coalesce(status, '') not in ('delivered','closed')
  );
  -- Close/delivered status updates require 'import.close' (owner/manager only)
  create policy import_shipments_close_status
  on public.import_shipments
  for update
  using (public.has_admin_permission('import.close'))
  with check (
    public.has_admin_permission('import.close')
    and status in ('delivered','closed')
  );

  -- import_shipments_items
  alter table public.import_shipments_items enable row level security;
  begin
    drop policy if exists "Admin users can manage import_shipments_items" on public.import_shipments_items;
  exception when undefined_object then null;
  end;
  create policy import_shipments_items_manage
  on public.import_shipments_items
  for all
  using (public.has_admin_permission('procurement.manage'))
  with check (public.has_admin_permission('procurement.manage'));

  -- import_expenses
  alter table public.import_expenses enable row level security;
  begin
    drop policy if exists "Admin users can manage import_expenses" on public.import_expenses;
  exception when undefined_object then null;
  end;
  create policy import_expenses_manage
  on public.import_expenses
  for all
  using (public.has_admin_permission('procurement.manage'))
  with check (public.has_admin_permission('procurement.manage'));
end $$;

-- 3) Inventory core tables: switch to has_admin_permission('inventory.manage')
do $$
begin
  -- inventory_movements
  alter table public.inventory_movements enable row level security;
  begin
    drop policy if exists inventory_movements_admin_only on public.inventory_movements;
  exception when undefined_object then null;
  end;
  create policy inventory_movements_manage
  on public.inventory_movements
  for all
  using (public.has_admin_permission('inventory.manage'))
  with check (public.has_admin_permission('inventory.manage'));

  -- order_item_cogs
  alter table public.order_item_cogs enable row level security;
  begin
    drop policy if exists order_item_cogs_admin_only on public.order_item_cogs;
  exception when undefined_object then null;
  end;
  create policy order_item_cogs_manage
  on public.order_item_cogs
  for all
  using (public.has_admin_permission('inventory.manage'))
  with check (public.has_admin_permission('inventory.manage'));

  -- stock_management
  alter table public.stock_management enable row level security;
  begin
    drop policy if exists stock_management_admin_only on public.stock_management;
  exception when undefined_object then null;
  end;
  create policy stock_management_manage
  on public.stock_management
  for all
  using (public.has_admin_permission('inventory.manage'))
  with check (public.has_admin_permission('inventory.manage'));
end $$;

-- 4) Reload PostgREST schema to reflect policy/function changes
notify pgrst, 'reload schema';

