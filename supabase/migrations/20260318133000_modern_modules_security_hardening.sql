set app.allow_ledger_ddl = '1';

alter table if exists public.recruitment_requests enable row level security;
alter table if exists public.recruitment_applicants enable row level security;
alter table if exists public.inventory_withdrawal_requests enable row level security;
alter table if exists public.inventory_withdrawal_items enable row level security;
alter table if exists public.letters_of_credit enable row level security;
alter table if exists public.lc_drawdowns enable row level security;
alter table if exists public.lc_expenses enable row level security;
alter table if exists public.lc_purchase_orders enable row level security;

drop policy if exists recruitment_requests_select on public.recruitment_requests;
create policy recruitment_requests_select
on public.recruitment_requests
for select
using (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.has_admin_permission('accounting.view')
  or public.is_admin()
);

drop policy if exists recruitment_requests_write on public.recruitment_requests;
create policy recruitment_requests_write
on public.recruitment_requests
for all
using (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.is_admin()
);

drop policy if exists recruitment_applicants_select on public.recruitment_applicants;
create policy recruitment_applicants_select
on public.recruitment_applicants
for select
using (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.has_admin_permission('accounting.view')
  or public.is_admin()
);

drop policy if exists recruitment_applicants_write on public.recruitment_applicants;
create policy recruitment_applicants_write
on public.recruitment_applicants
for all
using (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('hr.contracts.manage')
  or public.has_admin_permission('expenses.manage')
  or public.is_admin()
);

drop policy if exists inventory_withdrawal_requests_select on public.inventory_withdrawal_requests;
create policy inventory_withdrawal_requests_select
on public.inventory_withdrawal_requests
for select
using (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.has_admin_permission('accounting.view')
  or public.is_admin()
);

drop policy if exists inventory_withdrawal_requests_write on public.inventory_withdrawal_requests;
create policy inventory_withdrawal_requests_write
on public.inventory_withdrawal_requests
for all
using (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.is_admin()
);

drop policy if exists inventory_withdrawal_items_select on public.inventory_withdrawal_items;
create policy inventory_withdrawal_items_select
on public.inventory_withdrawal_items
for select
using (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.has_admin_permission('accounting.view')
  or public.is_admin()
);

drop policy if exists inventory_withdrawal_items_write on public.inventory_withdrawal_items;
create policy inventory_withdrawal_items_write
on public.inventory_withdrawal_items
for all
using (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('stock.manage')
  or public.has_admin_permission('inventory.manage')
  or public.is_admin()
);

drop policy if exists letters_of_credit_select on public.letters_of_credit;
create policy letters_of_credit_select
on public.letters_of_credit
for select
using (
  public.has_admin_permission('accounting.view')
  or public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists letters_of_credit_write on public.letters_of_credit;
create policy letters_of_credit_write
on public.letters_of_credit
for all
using (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_drawdowns_select on public.lc_drawdowns;
create policy lc_drawdowns_select
on public.lc_drawdowns
for select
using (
  public.has_admin_permission('accounting.view')
  or public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_drawdowns_write on public.lc_drawdowns;
create policy lc_drawdowns_write
on public.lc_drawdowns
for all
using (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_expenses_select on public.lc_expenses;
create policy lc_expenses_select
on public.lc_expenses
for select
using (
  public.has_admin_permission('accounting.view')
  or public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_expenses_write on public.lc_expenses;
create policy lc_expenses_write
on public.lc_expenses
for all
using (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_purchase_orders_select on public.lc_purchase_orders;
create policy lc_purchase_orders_select
on public.lc_purchase_orders
for select
using (
  public.has_admin_permission('accounting.view')
  or public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop policy if exists lc_purchase_orders_write on public.lc_purchase_orders;
create policy lc_purchase_orders_write
on public.lc_purchase_orders
for all
using (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
)
with check (
  public.has_admin_permission('accounting.manage')
  or public.has_admin_permission('stock.manage')
  or public.is_admin()
);

drop function if exists public.submit_withdrawal_request(uuid);
drop function if exists public.approve_withdrawal_request(uuid, text);
drop function if exists public.reject_withdrawal_request(uuid, text, text);
drop function if exists public.fulfill_withdrawal_request(uuid);
drop function if exists public.get_lc_summary(uuid);

create or replace function public.submit_withdrawal_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    auth.role() = 'service_role'
    or public.has_admin_permission('stock.manage')
    or public.has_admin_permission('inventory.manage')
    or public.is_admin()
  ) then
    raise exception 'not authorized';
  end if;

  update public.inventory_withdrawal_requests
  set status     = 'pending_approval',
      updated_at = now()
  where id = p_request_id
    and status = 'draft';

  if not found then
    raise exception 'request not in draft status';
  end if;
end;
$$;

create or replace function public.approve_withdrawal_request(
  p_request_id uuid,
  p_approved_by text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    auth.role() = 'service_role'
    or public.has_admin_permission('stock.manage')
    or public.has_admin_permission('inventory.manage')
    or public.is_admin()
  ) then
    raise exception 'not authorized';
  end if;

  update public.inventory_withdrawal_requests
  set status      = 'approved',
      approved_by_name = p_approved_by,
      approved_at = now(),
      updated_at  = now()
  where id = p_request_id
    and status = 'pending_approval';

  if not found then
    raise exception 'request not pending approval';
  end if;

  update public.inventory_withdrawal_items
  set approved_qty = requested_qty
  where request_id = p_request_id and approved_qty is null;
end;
$$;

create or replace function public.reject_withdrawal_request(
  p_request_id uuid,
  p_reason text,
  p_rejected_by text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    auth.role() = 'service_role'
    or public.has_admin_permission('stock.manage')
    or public.has_admin_permission('inventory.manage')
    or public.is_admin()
  ) then
    raise exception 'not authorized';
  end if;

  update public.inventory_withdrawal_requests
  set status           = 'rejected',
      rejection_reason = p_reason,
      approved_by_name = p_rejected_by,
      updated_at       = now()
  where id = p_request_id
    and status = 'pending_approval';

  if not found then
    raise exception 'request not pending approval';
  end if;
end;
$$;

create or replace function public.fulfill_withdrawal_request(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_item record;
  v_avail numeric;
  v_mv_id uuid;
begin
  if not (
    auth.role() = 'service_role'
    or public.has_admin_permission('stock.manage')
    or public.has_admin_permission('inventory.manage')
    or public.is_admin()
  ) then
    raise exception 'not authorized';
  end if;

  select warehouse_id into v_req
  from public.inventory_withdrawal_requests
  where id = p_request_id and status = 'approved';
  if not found then raise exception 'request not approved'; end if;

  for v_item in
    select * from public.inventory_withdrawal_items where request_id = p_request_id
  loop
    select available_quantity into v_avail
    from public.stock_management
    where item_id = v_item.item_id and warehouse_id = v_req.warehouse_id;

    if coalesce(v_avail, 0) < coalesce(v_item.approved_qty, v_item.requested_qty) then
      raise exception 'insufficient stock for item %', v_item.item_id;
    end if;

    update public.stock_management
    set available_quantity = available_quantity - coalesce(v_item.approved_qty, v_item.requested_qty),
        updated_at = now()
    where item_id = v_item.item_id and warehouse_id = v_req.warehouse_id;

    insert into public.inventory_movements (
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, warehouse_id, occurred_at
    )
    values (
      v_item.item_id, 'adjust_out', coalesce(v_item.approved_qty, v_item.requested_qty), 0, 0,
      'inventory_withdrawal_requests', p_request_id::text, v_req.warehouse_id, now()
    )
    returning id into v_mv_id;

    update public.inventory_withdrawal_items
    set fulfilled_qty = coalesce(v_item.approved_qty, v_item.requested_qty),
        movement_id = v_mv_id
    where id = v_item.id;
  end loop;

  update public.inventory_withdrawal_requests
  set status       = 'fulfilled',
      fulfilled_at = now(),
      updated_at   = now()
  where id = p_request_id;
end;
$$;

create or replace function public.get_lc_summary(p_lc_id uuid)
returns table (
  lc_amount numeric,
  utilized_amount numeric,
  remaining_amount numeric,
  total_expenses numeric,
  drawdown_count bigint,
  currency text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lc.lc_amount,
    lc.utilized_amount,
    lc.lc_amount - lc.utilized_amount as remaining_amount,
    coalesce((select sum(e.amount) from public.lc_expenses e where e.lc_id = lc.id), 0) as total_expenses,
    (select count(*) from public.lc_drawdowns d where d.lc_id = lc.id) as drawdown_count,
    lc.currency
  from public.letters_of_credit lc
  where lc.id = p_lc_id
    and (
      auth.role() = 'service_role'
      or public.has_admin_permission('accounting.view')
      or public.has_admin_permission('accounting.manage')
      or public.has_admin_permission('stock.manage')
      or public.is_admin()
    );
$$;

revoke all on function public.submit_withdrawal_request(uuid) from public;
revoke execute on function public.submit_withdrawal_request(uuid) from anon;
grant execute on function public.submit_withdrawal_request(uuid) to authenticated;

revoke all on function public.approve_withdrawal_request(uuid, text) from public;
revoke execute on function public.approve_withdrawal_request(uuid, text) from anon;
grant execute on function public.approve_withdrawal_request(uuid, text) to authenticated;

revoke all on function public.reject_withdrawal_request(uuid, text, text) from public;
revoke execute on function public.reject_withdrawal_request(uuid, text, text) from anon;
grant execute on function public.reject_withdrawal_request(uuid, text, text) to authenticated;

revoke all on function public.fulfill_withdrawal_request(uuid) from public;
revoke execute on function public.fulfill_withdrawal_request(uuid) from anon;
grant execute on function public.fulfill_withdrawal_request(uuid) to authenticated;

revoke all on function public.get_lc_summary(uuid) from public;
revoke execute on function public.get_lc_summary(uuid) from anon;
grant execute on function public.get_lc_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
