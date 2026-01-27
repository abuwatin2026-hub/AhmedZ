create table if not exists public.ar_open_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.orders(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  original_amount numeric not null check (original_amount > 0),
  open_balance numeric not null check (open_balance >= 0),
  status text not null check (status in ('open','closed')),
  currency text not null default 'YER',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.ar_open_items enable row level security;
alter table public.ar_open_items force row level security;
drop policy if exists ar_open_items_select on public.ar_open_items;
create policy ar_open_items_select
on public.ar_open_items
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ar_open_items_write on public.ar_open_items;
create policy ar_open_items_write
on public.ar_open_items
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ar_open_items_update on public.ar_open_items;
create policy ar_open_items_update
on public.ar_open_items
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));
create unique index if not exists uq_ar_open_item_invoice_open
on public.ar_open_items(invoice_id)
where status = 'open';

create table if not exists public.ar_allocations (
  id uuid primary key default gen_random_uuid(),
  open_item_id uuid not null references public.ar_open_items(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (open_item_id, payment_id)
);
alter table public.ar_allocations enable row level security;
alter table public.ar_allocations force row level security;
drop policy if exists ar_allocations_select on public.ar_allocations;
create policy ar_allocations_select
on public.ar_allocations
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ar_allocations_write on public.ar_allocations;
create policy ar_allocations_write
on public.ar_allocations
for insert
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.sync_ar_on_invoice(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;
  select je.id
  into v_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event = 'invoiced'
  limit 1;
  if not found then
    return;
  end if;
  select public.get_account_id_by_code('1200') into v_ar_id;
  if v_ar_id is null then
    raise exception 'AR account not found';
  end if;
  select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
  into v_ar_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry_id
    and jl.account_id = v_ar_id;
  if v_ar_amount is null or v_ar_amount <= 0 then
    return;
  end if;
  if exists (
    select 1 from public.ar_open_items a
    where a.invoice_id = p_order_id
      and a.status = 'open'
  ) then
    update public.ar_open_items
    set original_amount = v_ar_amount,
        open_balance = greatest(open_balance, v_ar_amount)
    where invoice_id = p_order_id
      and status = 'open';
  else
    insert into public.ar_open_items(invoice_id, order_id, journal_entry_id, original_amount, open_balance, status)
    values (p_order_id, p_order_id, v_entry_id, v_ar_amount, v_ar_amount, 'open');
  end if;
end;
$$;
revoke all on function public.sync_ar_on_invoice(uuid) from public;
grant execute on function public.sync_ar_on_invoice(uuid) to authenticated;

-- Allocation يصبح قراراً صريحاً فقط؛ لا منطق تلقائي هنا

create table if not exists public.ar_payment_status (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  eligible boolean not null default false,
  allocated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id)
);
alter table public.ar_payment_status enable row level security;
alter table public.ar_payment_status force row level security;
drop policy if exists ar_payment_status_select on public.ar_payment_status;
create policy ar_payment_status_select
on public.ar_payment_status
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists ar_payment_status_write on public.ar_payment_status;
create policy ar_payment_status_write
on public.ar_payment_status
for insert
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ar_payment_status_update on public.ar_payment_status;
create policy ar_payment_status_update
on public.ar_payment_status
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.flag_payment_allocation_status(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_order record;
  v_delivered_at timestamptz;
  v_is_cod boolean := false;
  v_eligible boolean := false;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  select *
  into v_pay
  from public.payments p
  where p.id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_pay.direction <> 'in' or v_pay.reference_table <> 'orders' then
    return;
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = (v_pay.reference_id)::uuid;
  if not found then
    return;
  end if;
  begin
    select public.order_delivered_at((v_pay.reference_id)::uuid) into v_delivered_at;
  exception when others then
    v_delivered_at := null;
  end;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  v_eligible := (v_delivered_at is not null) and (v_pay.occurred_at >= v_delivered_at) and (not v_is_cod);
  insert into public.ar_payment_status(payment_id, order_id, eligible, allocated, created_at, updated_at)
  values (p_payment_id, (v_pay.reference_id)::uuid, v_eligible, false, now(), now())
  on conflict (payment_id) do update
    set eligible = excluded.eligible,
        updated_at = now();
end;
$$;
revoke all on function public.flag_payment_allocation_status(uuid) from public;
grant execute on function public.flag_payment_allocation_status(uuid) to authenticated;

drop trigger if exists trg_journal_entries_sync_ar on public.journal_entries;
create or replace function public.trg_after_journal_entry_insert_flag_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_table = 'payments' and new.source_event like 'in:orders:%' then
    perform public.flag_payment_allocation_status((new.source_id)::uuid);
  end if;
  return new;
end;
$$;
create trigger trg_journal_entries_flag_payment
after insert on public.journal_entries
for each row execute function public.trg_after_journal_entry_insert_flag_payment();

create or replace function public.allocate_payment_to_open_item(
  p_open_item_id uuid,
  p_payment_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open record;
  v_pay record;
  v_amount numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;
  if p_open_item_id is null or p_payment_id is null then
    raise exception 'required ids';
  end if;
  select * into v_open from public.ar_open_items where id = p_open_item_id for update;
  if not found then
    raise exception 'open item not found';
  end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  v_amount := greatest(0, coalesce(p_amount, 0));
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  if v_amount - 1e-9 > v_open.open_balance then
    raise exception 'allocation exceeds open balance';
  end if;
  insert into public.ar_allocations(open_item_id, payment_id, amount, occurred_at, created_by)
  values (p_open_item_id, p_payment_id, v_amount, v_pay.occurred_at, auth.uid())
  on conflict (open_item_id, payment_id) do update set amount = excluded.amount;
  update public.ar_open_items
  set open_balance = greatest(0, open_balance - v_amount),
      status = case when greatest(0, open_balance - v_amount) = 0 then 'closed' else status end,
      closed_at = case when greatest(0, open_balance - v_amount) = 0 then now() else closed_at end
  where id = p_open_item_id;
  update public.ar_payment_status
  set allocated = true,
      updated_at = now()
  where payment_id = p_payment_id;
end;
$$;
revoke all on function public.allocate_payment_to_open_item(uuid, uuid, numeric) from public;
grant execute on function public.allocate_payment_to_open_item(uuid, uuid, numeric) to authenticated;

create or replace function public.ar_aging_as_of(p_as_of timestamptz)
returns table (
  invoice_id uuid,
  journal_entry_id uuid,
  original_amount numeric,
  open_balance numeric,
  days_past_due integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    a.invoice_id,
    a.journal_entry_id,
    a.original_amount,
    a.open_balance,
    greatest(0, (p_as_of::date - je.entry_date::date))::int as days_past_due
  from public.ar_open_items a
  join public.journal_entries je on je.id = a.journal_entry_id
  where a.status = 'open';
end;
$$;
revoke all on function public.ar_aging_as_of(timestamptz) from public;
grant execute on function public.ar_aging_as_of(timestamptz) to authenticated;
