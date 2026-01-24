create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id text not null,
  request_type text not null check (request_type in ('po','receipt','discount','transfer','writeoff')),
  status text not null check (status in ('pending','approved','rejected')),
  requested_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  payload_hash text not null,
  created_at timestamptz default now()
);
create index if not exists idx_approval_requests_target on public.approval_requests(target_table, target_id);
create index if not exists idx_approval_requests_status on public.approval_requests(status);
alter table public.approval_requests enable row level security;
drop policy if exists approval_requests_admin_all on public.approval_requests;
create policy approval_requests_admin_all on public.approval_requests
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_no int not null,
  approver_role text not null,
  status text not null check (status in ('pending','approved','rejected')),
  action_by uuid,
  action_at timestamptz
);
create unique index if not exists idx_approval_steps_request_step on public.approval_steps(request_id, step_no);
alter table public.approval_steps enable row level security;
drop policy if exists approval_steps_admin_all on public.approval_steps;
create policy approval_steps_admin_all on public.approval_steps
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  min_amount numeric not null,
  max_amount numeric,
  steps_count int not null,
  is_active boolean not null default true
);
create index if not exists idx_approval_policies_type on public.approval_policies(request_type, is_active);
alter table public.approval_policies enable row level security;
drop policy if exists approval_policies_admin_all on public.approval_policies;
create policy approval_policies_admin_all on public.approval_policies
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.approval_policy_steps (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.approval_policies(id) on delete cascade,
  step_no int not null,
  approver_role text not null
);
create unique index if not exists idx_approval_policy_steps_policy_step on public.approval_policy_steps(policy_id, step_no);
alter table public.approval_policy_steps enable row level security;
drop policy if exists approval_policy_steps_admin_all on public.approval_policy_steps;
create policy approval_policy_steps_admin_all on public.approval_policy_steps
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.approval_policies(request_type, min_amount, max_amount, steps_count, is_active)
select v.request_type, 0, null, 1, true
from (values ('po'),('receipt'),('discount'),('transfer'),('writeoff')) as v(request_type)
where not exists (
  select 1 from public.approval_policies p where p.request_type = v.request_type and p.is_active = true
);

insert into public.approval_policy_steps(policy_id, step_no, approver_role)
select p.id, 1, 'manager'
from public.approval_policies p
where p.steps_count = 1
  and not exists (
    select 1 from public.approval_policy_steps s where s.policy_id = p.id
  );

create or replace function public.approval_required(p_request_type text, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.approval_policies p
  where p.request_type = p_request_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0));
  return v_count > 0;
end;
$$;

create or replace function public.create_approval_request(
  p_target_table text,
  p_target_id text,
  p_request_type text,
  p_amount numeric,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_policy_id uuid;
  v_payload_hash text;
begin
  if not public.approval_required(p_request_type, p_amount) then
    raise exception 'approval policy not found for request_type %', p_request_type;
  end if;

  v_payload_hash := encode(digest(coalesce(p_payload::text, ''), 'sha256'), 'hex');

  insert into public.approval_requests(
    target_table, target_id, request_type, status, requested_by, payload_hash
  )
  values (
    p_target_table, p_target_id, p_request_type, 'pending', auth.uid(), v_payload_hash
  )
  returning id into v_request_id;

  select p.id into v_policy_id
  from public.approval_policies p
  where p.request_type = p_request_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0))
  order by p.min_amount desc
  limit 1;

  insert into public.approval_steps(request_id, step_no, approver_role, status)
  select v_request_id, s.step_no, s.approver_role, 'pending'
  from public.approval_policy_steps s
  where s.policy_id = v_policy_id
  order by s.step_no asc;

  return v_request_id;
end;
$$;

create or replace function public.approve_approval_step(p_request_id uuid, p_step_no int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  update public.approval_steps
  set status = 'approved', action_by = auth.uid(), action_at = now()
  where request_id = p_request_id and step_no = p_step_no and status = 'pending';

  select count(*)
  into v_remaining
  from public.approval_steps
  where request_id = p_request_id and status <> 'approved';

  if v_remaining = 0 then
    update public.approval_requests
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_request_id;
  end if;
end;
$$;

create or replace function public.reject_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.approval_requests
  set status = 'rejected', rejected_by = auth.uid(), rejected_at = now()
  where id = p_request_id;
  update public.approval_steps
  set status = 'rejected', action_by = auth.uid(), action_at = now()
  where request_id = p_request_id and status = 'pending';
end;
$$;

alter table public.purchase_orders
  add column if not exists approval_status text default 'pending',
  add column if not exists approval_request_id uuid references public.approval_requests(id),
  add column if not exists requires_approval boolean default false;

alter table public.purchase_receipts
  add column if not exists approval_status text default 'pending',
  add column if not exists approval_request_id uuid references public.approval_requests(id),
  add column if not exists requires_approval boolean default false;

alter table public.inventory_transfers
  add column if not exists approval_status text default 'pending',
  add column if not exists approval_request_id uuid references public.approval_requests(id),
  add column if not exists requires_approval boolean default false;

alter table public.inventory_movements
  add column if not exists approval_status text default 'pending',
  add column if not exists approval_request_id uuid references public.approval_requests(id),
  add column if not exists requires_approval boolean default false;

alter table public.orders
  add column if not exists discount_requires_approval boolean default false,
  add column if not exists discount_approval_status text default 'approved',
  add column if not exists discount_approval_request_id uuid references public.approval_requests(id);

create or replace function public.transfer_total_cost(p_transfer_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(quantity * unit_cost), 0)
  from public.inventory_transfer_items
  where transfer_id = p_transfer_id
$$;

create or replace function public.trg_enforce_po_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required boolean;
begin
  if tg_op = 'UPDATE' and new.status = 'completed' then
    v_required := public.approval_required('po', new.total_amount);
    new.requires_approval := v_required;
    if v_required and new.approval_status <> 'approved' then
      raise exception 'purchase order requires approval';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_po_approval on public.purchase_orders;
create trigger trg_enforce_po_approval
before update on public.purchase_orders
for each row execute function public.trg_enforce_po_approval();

create or replace function public.trg_enforce_receipt_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_required boolean;
begin
  select coalesce(total_amount, 0) into v_total
  from public.purchase_orders
  where id = new.purchase_order_id;

  v_required := public.approval_required('receipt', v_total);
  new.requires_approval := v_required;

  if v_required and new.approval_status <> 'approved' then
    raise exception 'purchase receipt requires approval';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_receipt_approval on public.purchase_receipts;
create trigger trg_enforce_receipt_approval
before insert or update on public.purchase_receipts
for each row execute function public.trg_enforce_receipt_approval();

create or replace function public.trg_enforce_transfer_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_required boolean;
begin
  v_total := public.transfer_total_cost(new.id);
  v_required := public.approval_required('transfer', v_total);
  new.requires_approval := v_required;

  if (new.state in ('IN_TRANSIT','RECEIVED')) and v_required and new.approval_status <> 'approved' then
    raise exception 'transfer requires approval';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_transfer_approval on public.inventory_transfers;
create trigger trg_enforce_transfer_approval
before update on public.inventory_transfers
for each row execute function public.trg_enforce_transfer_approval();

create or replace function public.trg_enforce_writeoff_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required boolean;
begin
  if new.movement_type in ('wastage_out','adjust_out') then
    v_required := public.approval_required('writeoff', new.total_cost);
    new.requires_approval := v_required;
    if v_required and new.approval_status <> 'approved' then
      raise exception 'writeoff requires approval';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_writeoff_approval on public.inventory_movements;
create trigger trg_enforce_writeoff_approval
before insert on public.inventory_movements
for each row execute function public.trg_enforce_writeoff_approval();

create or replace function public.trg_enforce_discount_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.discount_requires_approval and new.discount_approval_status <> 'approved' then
    if new.status in ('delivered','out_for_delivery','completed') then
      raise exception 'order discount requires approval';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_discount_approval on public.orders;
create trigger trg_enforce_discount_approval
before update on public.orders
for each row execute function public.trg_enforce_discount_approval();

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  invoice_number text not null,
  invoice_date date not null,
  currency text not null,
  fx_rate numeric,
  base_total numeric,
  total_amount numeric not null,
  status text not null check (status in ('draft','matched','exception','approved','rejected','posted')),
  created_by uuid not null,
  created_at timestamptz default now()
);
create unique index if not exists idx_supplier_invoice_unique on public.supplier_invoices(supplier_id, invoice_number);
alter table public.supplier_invoices enable row level security;
drop policy if exists supplier_invoices_admin_all on public.supplier_invoices;
create policy supplier_invoices_admin_all on public.supplier_invoices
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  item_id text not null,
  quantity numeric not null,
  unit_price numeric not null,
  line_total numeric not null,
  po_id uuid,
  receipt_id uuid
);
create index if not exists idx_supplier_invoice_lines_invoice on public.supplier_invoice_lines(invoice_id);
alter table public.supplier_invoice_lines enable row level security;
drop policy if exists supplier_invoice_lines_admin_all on public.supplier_invoice_lines;
create policy supplier_invoice_lines_admin_all on public.supplier_invoice_lines
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.three_way_match_results (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  po_id uuid,
  receipt_id uuid,
  item_id text not null,
  qty_po numeric not null,
  qty_grn numeric not null,
  qty_inv numeric not null,
  price_po numeric not null,
  price_inv numeric not null,
  status text not null check (status in ('matched','qty_variance','price_variance')),
  created_at timestamptz default now()
);
create index if not exists idx_three_way_match_invoice on public.three_way_match_results(invoice_id);
alter table public.three_way_match_results enable row level security;
drop policy if exists three_way_match_results_admin_all on public.three_way_match_results;
create policy three_way_match_results_admin_all on public.three_way_match_results
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.invoice_tolerances (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid,
  item_id text,
  qty_tolerance numeric not null default 0,
  price_tolerance numeric not null default 0,
  is_active boolean not null default true
);
alter table public.invoice_tolerances enable row level security;
drop policy if exists invoice_tolerances_admin_all on public.invoice_tolerances;
create policy invoice_tolerances_admin_all on public.invoice_tolerances
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values
  ('2025', 'Goods Received Not Invoiced', 'liability', 'credit'),
  ('5030', 'Purchase Price Variance', 'expense', 'debit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;

create or replace function public.calculate_three_way_match(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_qty_po numeric;
  v_qty_grn numeric;
  v_price_po numeric;
  v_qty_tol numeric;
  v_price_tol numeric;
  v_status text;
begin
  delete from public.three_way_match_results where invoice_id = p_invoice_id;

  for v_line in
    select *
    from public.supplier_invoice_lines
    where invoice_id = p_invoice_id
  loop
    select coalesce(sum(pi.quantity), 0), coalesce(avg(pi.unit_cost), 0)
    into v_qty_po, v_price_po
    from public.purchase_items pi
    where pi.purchase_order_id = v_line.po_id
      and pi.item_id = v_line.item_id;

    select coalesce(sum(pri.quantity), 0)
    into v_qty_grn
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.purchase_order_id = v_line.po_id
      and pri.item_id = v_line.item_id;

    select coalesce(it.qty_tolerance, 0), coalesce(it.price_tolerance, 0)
    into v_qty_tol, v_price_tol
    from public.invoice_tolerances it
    join public.supplier_invoices si on si.id = p_invoice_id
    where (it.supplier_id is null or it.supplier_id = si.supplier_id)
      and (it.item_id is null or it.item_id = v_line.item_id)
      and it.is_active = true
    order by (it.supplier_id is not null) desc, (it.item_id is not null) desc
    limit 1;

    if abs(coalesce(v_line.unit_price, 0) - coalesce(v_price_po, 0)) > v_price_tol then
      v_status := 'price_variance';
    elsif coalesce(v_line.quantity, 0) > coalesce(v_qty_grn, 0) + v_qty_tol then
      v_status := 'qty_variance';
    else
      v_status := 'matched';
    end if;

    insert into public.three_way_match_results(
      invoice_id, po_id, receipt_id, item_id,
      qty_po, qty_grn, qty_inv, price_po, price_inv, status
    )
    values (
      p_invoice_id, v_line.po_id, v_line.receipt_id, v_line.item_id,
      coalesce(v_qty_po, 0), coalesce(v_qty_grn, 0), coalesce(v_line.quantity, 0),
      coalesce(v_price_po, 0), coalesce(v_line.unit_price, 0), v_status
    );
  end loop;

  if exists (
    select 1 from public.three_way_match_results
    where invoice_id = p_invoice_id and status <> 'matched'
  ) then
    update public.supplier_invoices set status = 'exception' where id = p_invoice_id;
  else
    update public.supplier_invoices set status = 'matched' where id = p_invoice_id;
  end if;
end;
$$;

create or replace function public.post_supplier_invoice_variance(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_variance numeric;
  v_entry_id uuid;
  v_ap uuid;
  v_ppv uuid;
begin
  select * into v_inv from public.supplier_invoices where id = p_invoice_id;
  if not found then
    raise exception 'supplier invoice not found';
  end if;
  if v_inv.status <> 'matched' then
    raise exception 'invoice is not matched';
  end if;

  select coalesce(sum(line_total), 0) into v_variance
  from public.supplier_invoice_lines
  where invoice_id = p_invoice_id;

  v_variance := v_variance - coalesce(v_inv.total_amount, 0);
  if abs(v_variance) < 0.0001 then
    update public.supplier_invoices set status = 'posted' where id = p_invoice_id;
    return;
  end if;

  v_ap := public.get_account_id_by_code('2010');
  v_ppv := public.get_account_id_by_code('5030');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    now(),
    concat('Supplier invoice variance ', v_inv.invoice_number),
    'supplier_invoices',
    v_inv.id::text,
    'variance',
    auth.uid()
  )
  returning id into v_entry_id;

  if v_variance > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ppv, v_variance, 0, 'Price variance'),
      (v_entry_id, v_ap, 0, v_variance, 'Increase payable');
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, abs(v_variance), 0, 'Decrease payable'),
      (v_entry_id, v_ppv, 0, abs(v_variance), 'Price variance');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
  update public.supplier_invoices set status = 'posted' where id = p_invoice_id;
end;
$$;

create table if not exists public.qc_checks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  check_type text not null,
  result text not null check (result in ('pass','fail')),
  checked_by uuid not null,
  checked_at timestamptz default now(),
  notes text
);
alter table public.qc_checks enable row level security;
drop policy if exists qc_checks_admin_all on public.qc_checks;
create policy qc_checks_admin_all on public.qc_checks
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.batches
  add column if not exists qc_status text default 'quarantined';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'batches'
      and column_name = 'qc_status'
  ) then
    update public.batches set qc_status = 'released' where qc_status is null;
  end if;
end $$;

create table if not exists public.batch_recalls (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  recall_reason text not null,
  initiated_by uuid not null,
  initiated_at timestamptz default now(),
  status text not null check (status in ('active','closed'))
);
alter table public.batch_recalls enable row level security;
drop policy if exists batch_recalls_admin_all on public.batch_recalls;
create policy batch_recalls_admin_all on public.batch_recalls
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.batch_sales_trace (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id),
  order_id uuid not null references public.orders(id),
  order_item_id uuid,
  quantity numeric not null,
  sold_at timestamptz not null
);
create index if not exists idx_batch_sales_trace_batch on public.batch_sales_trace(batch_id);
alter table public.batch_sales_trace enable row level security;
drop policy if exists batch_sales_trace_admin_all on public.batch_sales_trace;
create policy batch_sales_trace_admin_all on public.batch_sales_trace
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.trg_recall_batch_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    update public.batches set qc_status = 'recalled' where id = new.batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recall_batch_update on public.batch_recalls;
create trigger trg_recall_batch_update
after insert or update on public.batch_recalls
for each row execute function public.trg_recall_batch_update();

create or replace function public.trg_block_sale_on_qc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qc text;
  v_recall boolean;
begin
  if new.movement_type in ('sale_out','transfer_out') and new.batch_id is not null then
    select qc_status into v_qc from public.batches where id = new.batch_id;
    select exists(
      select 1 from public.batch_recalls br
      where br.batch_id = new.batch_id and br.status = 'active'
    ) into v_recall;
    if v_qc is distinct from 'released' or v_recall then
      raise exception 'batch not released or recalled';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_sale_on_qc on public.inventory_movements;
create trigger trg_block_sale_on_qc
before insert on public.inventory_movements
for each row execute function public.trg_block_sale_on_qc();

create or replace function public.trg_trace_batch_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.movement_type = 'sale_out' and new.batch_id is not null and new.reference_table = 'orders' then
    insert into public.batch_sales_trace(batch_id, order_id, quantity, sold_at)
    values (new.batch_id, new.reference_id::uuid, new.quantity, new.occurred_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trace_batch_sales on public.inventory_movements;
create trigger trg_trace_batch_sales
after insert on public.inventory_movements
for each row execute function public.trg_trace_batch_sales();

create table if not exists public.currencies (
  code text primary key,
  name text not null,
  is_base boolean not null default false
);
alter table public.currencies enable row level security;
drop policy if exists currencies_admin_all on public.currencies;
create policy currencies_admin_all on public.currencies
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.currencies(code, name, is_base)
select 'YER', 'Yemeni Rial', true
where not exists (select 1 from public.currencies where is_base = true);

create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currencies(code),
  rate numeric not null,
  rate_date date not null,
  rate_type text not null check (rate_type in ('operational','accounting')),
  unique(currency_code, rate_date, rate_type)
);
alter table public.fx_rates enable row level security;
drop policy if exists fx_rates_admin_all on public.fx_rates;
create policy fx_rates_admin_all on public.fx_rates
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
select c.code, 1, current_date, 'operational'
from public.currencies c
where c.is_base = true
on conflict do nothing;

insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
select c.code, 1, current_date, 'accounting'
from public.currencies c
where c.is_base = true
on conflict do nothing;

create or replace function public.get_base_currency()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select code from public.currencies where is_base = true limit 1
$$;

create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select rate
  from public.fx_rates
  where currency_code = p_currency
    and rate_type = p_rate_type
    and rate_date = p_date
  limit 1
$$;

alter table public.orders
  add column if not exists currency text,
  add column if not exists fx_rate numeric,
  add column if not exists base_total numeric;

alter table public.payments
  add column if not exists currency text,
  add column if not exists fx_rate numeric,
  add column if not exists base_amount numeric;

create or replace function public.trg_set_order_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_rate numeric;
begin
  v_base := public.get_base_currency();
  if new.currency is null then
    new.currency := v_base;
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  new.base_total := coalesce(new.total, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

drop trigger if exists trg_set_order_fx on public.orders;
create trigger trg_set_order_fx
before insert or update on public.orders
for each row execute function public.trg_set_order_fx();

create or replace function public.trg_set_payment_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_rate numeric;
begin
  v_base := public.get_base_currency();
  if new.currency is null then
    new.currency := v_base;
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  new.base_amount := coalesce(new.amount, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

drop trigger if exists trg_set_payment_fx on public.payments;
create trigger trg_set_payment_fx
before insert or update on public.payments
for each row execute function public.trg_set_payment_fx();

create table if not exists public.tax_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null
);
alter table public.tax_jurisdictions enable row level security;
drop policy if exists tax_jurisdictions_admin_all on public.tax_jurisdictions;
create policy tax_jurisdictions_admin_all on public.tax_jurisdictions
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.tax_jurisdictions(id),
  tax_code text not null,
  rate numeric not null,
  effective_from date not null,
  effective_to date
);
alter table public.tax_rates enable row level security;
drop policy if exists tax_rates_admin_all on public.tax_rates;
create policy tax_rates_admin_all on public.tax_rates
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.item_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  tax_code text not null
);
alter table public.item_tax_profiles enable row level security;
drop policy if exists item_tax_profiles_admin_all on public.item_tax_profiles;
create policy item_tax_profiles_admin_all on public.item_tax_profiles
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.customer_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(auth_user_id),
  jurisdiction_id uuid not null references public.tax_jurisdictions(id)
);
alter table public.customer_tax_profiles enable row level security;
drop policy if exists customer_tax_profiles_admin_all on public.customer_tax_profiles;
create policy customer_tax_profiles_admin_all on public.customer_tax_profiles
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.order_tax_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  tax_code text not null,
  tax_rate numeric not null,
  tax_amount numeric not null
);
alter table public.order_tax_lines enable row level security;
drop policy if exists order_tax_lines_admin_all on public.order_tax_lines;
create policy order_tax_lines_admin_all on public.order_tax_lines
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.compute_order_tax_lines(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item jsonb;
  v_tax_code text;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_jurisdiction uuid;
  v_line_total numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  delete from public.order_tax_lines where order_id = p_order_id;

  select ctp.jurisdiction_id into v_jurisdiction
  from public.customer_tax_profiles ctp
  where ctp.customer_id = v_order.customer_auth_user_id
  limit 1;

  for v_item in select value from jsonb_array_elements(coalesce(v_order.items, v_order.data->'items', '[]'::jsonb))
  loop
    v_tax_code := nullif(v_item->>'taxCode', '');
    if v_tax_code is null then
      select itp.tax_code into v_tax_code
      from public.item_tax_profiles itp
      where itp.item_id = coalesce(v_item->>'itemId', v_item->>'id')
      limit 1;
    end if;
    if v_tax_code is null or v_jurisdiction is null then
      raise exception 'missing tax profile';
    end if;
    select tr.rate into v_tax_rate
    from public.tax_rates tr
    where tr.jurisdiction_id = v_jurisdiction
      and tr.tax_code = v_tax_code
      and tr.effective_from <= current_date
      and (tr.effective_to is null or tr.effective_to >= current_date)
    order by tr.effective_from desc
    limit 1;
    if v_tax_rate is null then
      raise exception 'missing tax rate';
    end if;
    v_line_total := coalesce((v_item->>'price')::numeric, 0) * coalesce((v_item->>'quantity')::numeric, 0);
    v_tax_amount := v_line_total * v_tax_rate;
    insert into public.order_tax_lines(order_id, tax_code, tax_rate, tax_amount)
    values (p_order_id, v_tax_code, v_tax_rate, v_tax_amount);
  end loop;
end;
$$;

create table if not exists public.uom (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null
);
create unique index if not exists idx_uom_code on public.uom(code);
alter table public.uom enable row level security;
drop policy if exists uom_admin_all on public.uom;
create policy uom_admin_all on public.uom
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.uom_conversions (
  id uuid primary key default gen_random_uuid(),
  from_uom_id uuid not null references public.uom(id),
  to_uom_id uuid not null references public.uom(id),
  numerator bigint not null,
  denominator bigint not null,
  unique(from_uom_id, to_uom_id)
);
alter table public.uom_conversions enable row level security;
drop policy if exists uom_conversions_admin_all on public.uom_conversions;
create policy uom_conversions_admin_all on public.uom_conversions
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.item_uom (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  base_uom_id uuid not null references public.uom(id),
  purchase_uom_id uuid references public.uom(id),
  sales_uom_id uuid references public.uom(id)
);
create unique index if not exists idx_item_uom_item on public.item_uom(item_id);
alter table public.item_uom enable row level security;
drop policy if exists item_uom_admin_all on public.item_uom;
create policy item_uom_admin_all on public.item_uom
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_or_create_uom(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.uom where code = p_code limit 1;
  if v_id is null then
    insert into public.uom(code, name) values (p_code, p_code) returning id into v_id;
  end if;
  return v_id;
end;
$$;

do $$
declare
  v_rec record;
  v_uom_id uuid;
begin
  for v_rec in select distinct nullif(btrim(base_unit), '') as base_unit from public.menu_items
  loop
    if v_rec.base_unit is not null then
      v_uom_id := public.get_or_create_uom(v_rec.base_unit);
    end if;
  end loop;
end $$;

insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
select mi.id, public.get_or_create_uom(mi.base_unit), null, null
from public.menu_items mi
where not exists (
  select 1 from public.item_uom iu where iu.item_id = mi.id
);

alter table public.purchase_items
  add column if not exists uom_id uuid references public.uom(id),
  add column if not exists qty_base numeric;

alter table public.purchase_receipt_items
  add column if not exists uom_id uuid references public.uom(id),
  add column if not exists qty_base numeric;

alter table public.inventory_movements
  add column if not exists uom_id uuid references public.uom(id),
  add column if not exists qty_base numeric;

alter table public.inventory_transfer_items
  add column if not exists uom_id uuid references public.uom(id),
  add column if not exists qty_base numeric;

create or replace function public.convert_qty(p_qty numeric, p_from uuid, p_to uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num bigint;
  v_den bigint;
begin
  if p_from = p_to then
    return p_qty;
  end if;
  select numerator, denominator into v_num, v_den
  from public.uom_conversions
  where from_uom_id = p_from and to_uom_id = p_to
  limit 1;
  if v_num is null or v_den is null then
    raise exception 'missing uom conversion';
  end if;
  return p_qty * (v_num::numeric / v_den::numeric);
end;
$$;

create or replace function public.trg_set_qty_base_purchase_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$$;

drop trigger if exists trg_set_qty_base_purchase_items on public.purchase_items;
create trigger trg_set_qty_base_purchase_items
before insert or update on public.purchase_items
for each row execute function public.trg_set_qty_base_purchase_items();

create or replace function public.trg_set_qty_base_receipt_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$$;

drop trigger if exists trg_set_qty_base_receipt_items on public.purchase_receipt_items;
create trigger trg_set_qty_base_receipt_items
before insert or update on public.purchase_receipt_items
for each row execute function public.trg_set_qty_base_receipt_items();

create or replace function public.trg_set_qty_base_inventory_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$$;

drop trigger if exists trg_set_qty_base_inventory_movements on public.inventory_movements;
create trigger trg_set_qty_base_inventory_movements
before insert or update on public.inventory_movements
for each row execute function public.trg_set_qty_base_inventory_movements();

create or replace function public.trg_set_qty_base_transfer_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;
  new.qty_base := public.convert_qty(new.quantity, new.uom_id, v_base);
  return new;
end;
$$;

drop trigger if exists trg_set_qty_base_transfer_items on public.inventory_transfer_items;
create trigger trg_set_qty_base_transfer_items
before insert or update on public.inventory_transfer_items
for each row execute function public.trg_set_qty_base_transfer_items();

create table if not exists public.order_line_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id text,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric not null,
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_order_line_items_order on public.order_line_items(order_id);
alter table public.order_line_items enable row level security;
drop policy if exists order_line_items_admin_all on public.order_line_items;
create policy order_line_items_admin_all on public.order_line_items
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.rebuild_order_line_items(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  delete from public.order_line_items where order_id = p_order_id;
  for v_item in select value from jsonb_array_elements(coalesce(v_order.items, v_order.data->'items', '[]'::jsonb))
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'price')::numeric, 0);
    insert into public.order_line_items(order_id, item_id, quantity, unit_price, total, data)
    values (p_order_id, v_item_id, v_qty, v_price, v_qty * v_price, v_item);
  end loop;
end;
$$;

create or replace function public.trg_sync_order_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rebuild_order_line_items(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_order_line_items on public.orders;
create trigger trg_sync_order_line_items
after insert or update on public.orders
for each row execute function public.trg_sync_order_line_items();

create table if not exists public.job_schedules (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  cron_expr text not null,
  is_active boolean not null default true
);
alter table public.job_schedules enable row level security;
drop policy if exists job_schedules_admin_all on public.job_schedules;
create policy job_schedules_admin_all on public.job_schedules
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running','success','failed')),
  error text
);
alter table public.job_runs enable row level security;
drop policy if exists job_runs_admin_all on public.job_runs;
create policy job_runs_admin_all on public.job_runs
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.run_expiry_job()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  insert into public.job_runs(job_name, started_at, status)
  values ('process_expired_batches', now(), 'running')
  returning id into v_run_id;
  begin
    perform public.process_expired_items();
    update public.job_runs set status = 'success', finished_at = now() where id = v_run_id;
  exception when others then
    update public.job_runs set status = 'failed', finished_at = now(), error = sqlerrm where id = v_run_id;
    raise;
  end;
end;
$$;

create index if not exists idx_batches_fefo on public.batches(item_id, warehouse_id, expiry_date, created_at);
create index if not exists idx_batch_balances_item on public.batch_balances(item_id, warehouse_id);
create index if not exists idx_stock_management_item on public.stock_management(item_id, warehouse_id);

create or replace function public.trg_validate_reserved_batches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_qc text;
  v_recall boolean;
begin
  if jsonb_typeof(new.data->'reservedBatches') = 'object' then
    for v_key in select key from jsonb_each(new.data->'reservedBatches')
    loop
      select qc_status into v_qc from public.batches where id = v_key::uuid;
      select exists(
        select 1 from public.batch_recalls br
        where br.batch_id = v_key::uuid and br.status = 'active'
      ) into v_recall;
      if v_qc is distinct from 'released' or v_recall then
        raise exception 'reserved batch not released or recalled';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_reserved_batches on public.stock_management;
create trigger trg_validate_reserved_batches
before update on public.stock_management
for each row execute function public.trg_validate_reserved_batches();
