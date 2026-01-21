create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.chart_of_accounts enable row level security;
drop policy if exists coa_admin_select on public.chart_of_accounts;
create policy coa_admin_select
on public.chart_of_accounts
for select
using (public.is_admin());
drop policy if exists coa_admin_write on public.chart_of_accounts;
create policy coa_admin_write
on public.chart_of_accounts
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date timestamptz not null default now(),
  memo text,
  source_table text,
  source_id text,
  source_event text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_journal_entries_source
on public.journal_entries(source_table, source_id, source_event);
alter table public.journal_entries enable row level security;
drop policy if exists journal_entries_admin_select on public.journal_entries;
create policy journal_entries_admin_select
on public.journal_entries
for select
using (public.is_admin());
drop policy if exists journal_entries_admin_write on public.journal_entries;
create policy journal_entries_admin_write
on public.journal_entries
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  line_memo text,
  created_at timestamptz not null default now(),
  check (not (debit > 0 and credit > 0))
);
create index if not exists idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_journal_lines_account on public.journal_lines(account_id);
alter table public.journal_lines enable row level security;
drop policy if exists journal_lines_admin_select on public.journal_lines;
create policy journal_lines_admin_select
on public.journal_lines
for select
using (public.is_admin());
drop policy if exists journal_lines_admin_write on public.journal_lines;
create policy journal_lines_admin_write
on public.journal_lines
for all
using (public.is_admin())
with check (public.is_admin());
insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values
  ('1010', 'Cash', 'asset', 'debit'),
  ('1020', 'Bank', 'asset', 'debit'),
  ('1200', 'Accounts Receivable', 'asset', 'debit'),
  ('2010', 'Accounts Payable', 'liability', 'credit'),
  ('2050', 'Customer Deposits', 'liability', 'credit'),
  ('4010', 'Sales Revenue', 'income', 'credit'),
  ('5010', 'Cost of Goods Sold', 'expense', 'debit'),
  ('1410', 'Inventory', 'asset', 'debit'),
  ('6100', 'Operating Expenses', 'expense', 'debit'),
  ('3000', 'Retained Earnings', 'equity', 'credit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;
create or replace function public.get_account_id_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coa.id
  from public.chart_of_accounts coa
  where coa.code = p_code and coa.is_active = true
  limit 1
$$;
revoke all on function public.get_account_id_by_code(text) from public;
grant execute on function public.get_account_id_by_code(text) to anon, authenticated;
create or replace function public.post_inventory_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry_id uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ap uuid;
begin
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select *
  into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;

  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.movement_type not in ('purchase_in', 'sale_out') then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
create or replace function public.post_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_sales uuid;
  v_ap uuid;
  v_expenses uuid;
  v_debit_account uuid;
  v_credit_account uuid;
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

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_sales := public.get_account_id_by_code('4010');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('in:orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
      (v_entry_id, v_sales, 0, v_pay.amount, 'Sales revenue');
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_expenses, v_pay.amount, 0, 'Operating expense'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    return;
  end if;
end;
$$;
revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;
create or replace function public.trg_post_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.post_inventory_movement(new.id);
  return new;
end;
$$;
drop trigger if exists trg_inventory_movements_post on public.inventory_movements;
create trigger trg_inventory_movements_post
after insert on public.inventory_movements
for each row execute function public.trg_post_inventory_movement();
create or replace function public.trg_post_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.post_payment(new.id);
  return new;
end;
$$;
drop trigger if exists trg_payments_post on public.payments;
create trigger trg_payments_post
after insert or update on public.payments
for each row execute function public.trg_post_payment();
