create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.companies enable row level security;
drop policy if exists companies_admin_all on public.companies;
create policy companies_admin_all on public.companies
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_branches_code on public.branches(company_id, code);
alter table public.branches enable row level security;
drop policy if exists branches_admin_all on public.branches;
create policy branches_admin_all on public.branches
  for all using (public.is_admin()) with check (public.is_admin());

-- Clean install: لا تنشئ شركة/فرع افتراضيين
do $$
begin
  perform 1;
end $$;

alter table public.admin_users
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists branch_id uuid references public.branches(id);

alter table public.warehouses
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists branch_id uuid references public.branches(id);

do $$
declare
  v_company_id uuid;
  v_branch_id uuid;
begin
  select id into v_company_id from public.companies limit 1;
  select id into v_branch_id from public.branches where company_id = v_company_id limit 1;
  update public.warehouses
  set company_id = coalesce(company_id, v_company_id),
      branch_id = coalesce(branch_id, v_branch_id);
end $$;

create or replace function public.get_default_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.branches b
  where b.is_active = true
  order by b.created_at asc
  limit 1
$$;

create or replace function public.get_default_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.companies c
  where c.is_active = true
  order by c.created_at asc
  limit 1
$$;

create or replace function public.branch_from_warehouse(p_warehouse_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.branch_id from public.warehouses w where w.id = p_warehouse_id
$$;

create or replace function public.company_from_branch(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.company_id from public.branches b where b.id = p_branch_id
$$;

alter table public.purchase_orders
  add column if not exists warehouse_id uuid references public.warehouses(id),
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.purchase_receipts
  add column if not exists warehouse_id uuid references public.warehouses(id),
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.inventory_transfers
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.inventory_movements
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.orders
  add column if not exists warehouse_id uuid references public.warehouses(id),
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.payments
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.supplier_invoices
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

alter table public.approval_requests
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

create or replace function public.trg_set_po_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.warehouse_id is null then
    select id into new.warehouse_id
    from public.warehouses
    where is_active = true
    order by created_at asc
    limit 1;
  end if;
  v_branch := public.branch_from_warehouse(new.warehouse_id);
  if v_branch is null then
    v_branch := public.get_default_branch_id();
  end if;
  new.branch_id := coalesce(new.branch_id, v_branch);
  v_company := public.company_from_branch(new.branch_id);
  new.company_id := coalesce(new.company_id, v_company, public.get_default_company_id());
  return new;
end;
$$;

drop trigger if exists trg_set_po_branch_scope on public.purchase_orders;
create trigger trg_set_po_branch_scope
before insert or update on public.purchase_orders
for each row execute function public.trg_set_po_branch_scope();

create or replace function public.trg_set_receipt_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
begin
  select * into v_po from public.purchase_orders where id = new.purchase_order_id;
  if new.warehouse_id is null then
    new.warehouse_id := v_po.warehouse_id;
  end if;
  new.branch_id := coalesce(new.branch_id, v_po.branch_id, public.branch_from_warehouse(new.warehouse_id));
  new.company_id := coalesce(new.company_id, v_po.company_id, public.company_from_branch(new.branch_id));
  return new;
end;
$$;

drop trigger if exists trg_set_receipt_branch_scope on public.purchase_receipts;
create trigger trg_set_receipt_branch_scope
before insert or update on public.purchase_receipts
for each row execute function public.trg_set_receipt_branch_scope();

create or replace function public.trg_set_order_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.warehouse_id is null then
    if nullif(new.data->>'warehouseId','') is not null and (new.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      new.warehouse_id := (new.data->>'warehouseId')::uuid;
    else
      select id into new.warehouse_id
      from public.warehouses
      where is_active = true
      order by created_at asc
      limit 1;
    end if;
  end if;
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$$;

drop trigger if exists trg_set_order_branch_scope on public.orders;
create trigger trg_set_order_branch_scope
before insert or update on public.orders
for each row execute function public.trg_set_order_branch_scope();

create or replace function public.trg_set_movement_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$$;

drop trigger if exists trg_set_movement_branch_scope on public.inventory_movements;
create trigger trg_set_movement_branch_scope
before insert or update on public.inventory_movements
for each row execute function public.trg_set_movement_branch_scope();

create or replace function public.trg_set_transfer_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.branch_id := coalesce(new.branch_id, public.branch_from_warehouse(new.from_warehouse_id), public.get_default_branch_id());
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$$;

drop trigger if exists trg_set_transfer_branch_scope on public.inventory_transfers;
create trigger trg_set_transfer_branch_scope
before insert or update on public.inventory_transfers
for each row execute function public.trg_set_transfer_branch_scope();

create or replace function public.trg_set_payment_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.branch_id is null then
    if new.reference_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = nullif(new.reference_id, '')::uuid;
    elsif new.reference_table = 'purchase_orders' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_orders where id = nullif(new.reference_id, '')::uuid;
    elsif new.reference_table = 'expenses' then
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
    end if;
    new.branch_id := coalesce(new.branch_id, v_branch, public.get_default_branch_id());
    new.company_id := coalesce(new.company_id, v_company, public.company_from_branch(new.branch_id), public.get_default_company_id());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_payment_branch_scope on public.payments;
create trigger trg_set_payment_branch_scope
before insert or update on public.payments
for each row execute function public.trg_set_payment_branch_scope();

create or replace function public.trg_set_supplier_invoice_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is null then
    new.branch_id := public.get_default_branch_id();
  end if;
  new.company_id := coalesce(new.company_id, public.company_from_branch(new.branch_id), public.get_default_company_id());
  return new;
end;
$$;

drop trigger if exists trg_set_supplier_invoice_branch_scope on public.supplier_invoices;
create trigger trg_set_supplier_invoice_branch_scope
before insert or update on public.supplier_invoices
for each row execute function public.trg_set_supplier_invoice_branch_scope();

create or replace function public.trg_set_approval_request_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_company uuid;
begin
  if new.branch_id is null then
    if new.target_table = 'purchase_orders' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_orders where id = new.target_id::uuid;
    elsif new.target_table = 'purchase_receipts' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_receipts where id = new.target_id::uuid;
    elsif new.target_table = 'inventory_transfers' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_transfers where id = new.target_id::uuid;
    elsif new.target_table = 'inventory_movements' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_movements where id = new.target_id::uuid;
    elsif new.target_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = new.target_id::uuid;
    end if;
    new.branch_id := coalesce(v_branch, public.get_default_branch_id());
    new.company_id := coalesce(v_company, public.company_from_branch(new.branch_id), public.get_default_company_id());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_approval_request_scope on public.approval_requests;
create trigger trg_set_approval_request_scope
before insert on public.approval_requests
for each row execute function public.trg_set_approval_request_scope();

create or replace function public.trg_enforce_approval_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from public.approval_requests where id = new.request_id;
  if v_branch is not null then
    if exists (
      select 1 from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.branch_id is distinct from v_branch
    ) then
      raise exception 'cross-branch approval is not allowed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_approval_branch on public.approval_steps;
create trigger trg_enforce_approval_branch
before update on public.approval_steps
for each row execute function public.trg_enforce_approval_branch();

create table if not exists public.accounting_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('po','grn','invoice','payment','writeoff','manual','movement')),
  source_table text not null,
  source_id text not null,
  branch_id uuid not null references public.branches(id),
  company_id uuid not null references public.companies(id),
  status text not null check (status in ('posted','reversed')),
  memo text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_document_id uuid references public.accounting_documents(id)
);
create unique index if not exists idx_accounting_documents_source on public.accounting_documents(source_table, source_id);
alter table public.accounting_documents enable row level security;
drop policy if exists accounting_documents_admin_all on public.accounting_documents;
create policy accounting_documents_admin_all on public.accounting_documents
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

alter table public.journal_entries
  add column if not exists document_id uuid references public.accounting_documents(id),
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists company_id uuid references public.companies(id);

create or replace function public.trg_immutable_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'immutable record';
end;
$$;

drop trigger if exists trg_accounting_documents_immutable on public.accounting_documents;
create trigger trg_accounting_documents_immutable
before update or delete on public.accounting_documents
for each row execute function public.trg_immutable_block();

drop trigger if exists trg_journal_entries_immutable on public.journal_entries;
create trigger trg_journal_entries_immutable
before update or delete on public.journal_entries
for each row execute function public.trg_immutable_block();

drop trigger if exists trg_journal_lines_immutable on public.journal_lines;
create trigger trg_journal_lines_immutable
before update or delete on public.journal_lines
for each row execute function public.trg_immutable_block();

create or replace function public.create_accounting_document(
  p_document_type text,
  p_source_table text,
  p_source_id text,
  p_branch_id uuid,
  p_company_id uuid,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.accounting_documents
  where source_table = p_source_table and source_id = p_source_id;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.accounting_documents(
    document_type, source_table, source_id, branch_id, company_id, status, memo, created_by
  )
  values (
    p_document_type, p_source_table, p_source_id, p_branch_id, p_company_id, 'posted', p_memo, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.trg_journal_entries_set_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_company uuid;
  v_doc_type text;
begin
  if new.branch_id is null then
    if new.source_table = 'inventory_movements' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_movements where id = new.source_id::uuid;
      v_doc_type := 'movement';
    elsif new.source_table = 'purchase_receipts' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_receipts where id = new.source_id::uuid;
      v_doc_type := 'grn';
    elsif new.source_table = 'supplier_invoices' then
      select branch_id, company_id into v_branch, v_company
      from public.supplier_invoices where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'payments' then
      select branch_id, company_id into v_branch, v_company
      from public.payments where id = new.source_id::uuid;
      v_doc_type := 'payment';
    elsif new.source_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'manual' then
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'manual';
    else
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'movement';
    end if;
    new.branch_id := coalesce(new.branch_id, v_branch);
    new.company_id := coalesce(new.company_id, v_company);
  end if;
  if new.document_id is null then
    new.document_id := public.create_accounting_document(
      coalesce(v_doc_type, 'movement'),
      coalesce(new.source_table, 'manual'),
      coalesce(new.source_id, new.id::text),
      new.branch_id,
      new.company_id,
      new.memo
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_set_document on public.journal_entries;
create trigger trg_journal_entries_set_document
before insert on public.journal_entries
for each row execute function public.trg_journal_entries_set_document();

create or replace function public.create_reversal_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_new_id uuid;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
  values (
    now(),
    concat('Reversal: ', coalesce(v_entry.memo, ''), ' ', coalesce(p_reason, '')),
    'journal_entries',
    v_entry.id::text,
    'reversal',
    auth.uid(),
    v_entry.document_id,
    v_entry.branch_id,
    v_entry.company_id
  )
  returning id into v_new_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select v_new_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  return v_new_id;
end;
$$;

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
  v_shrinkage uuid;
  v_gain uuid;
  v_vat_input uuid;
  v_supplier_tax_total numeric;
  v_doc_type text;
begin
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select * into v_mv from public.inventory_movements im where im.id = p_movement_id;
  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  if exists (
    select 1 from public.journal_entries je
    where je.source_table = 'inventory_movements'
      and je.source_id = v_mv.id::text
      and je.source_event = v_mv.movement_type
  ) then
    raise exception 'posting already exists for this source; create a reversal instead';
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');
  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

  if v_mv.movement_type in ('wastage_out','adjust_out') then
    v_doc_type := 'writeoff';
  elsif v_mv.movement_type = 'purchase_in' then
    v_doc_type := 'grn';
  else
    v_doc_type := 'movement';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  returning id into v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    if v_supplier_tax_total > 0 and v_vat_input is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost - v_supplier_tax_total, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT input'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Wastage'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Adjustment in'),
      (v_entry_id, v_gain, 0, v_mv.total_cost, 'Inventory gain');
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

create or replace function public.trg_freeze_ledger_tables()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd record;
  v_allow text;
begin
  v_allow := current_setting('app.allow_ledger_ddl', true);
  if v_allow = '1' then
    return;
  end if;
  for v_cmd in select * from pg_event_trigger_ddl_commands()
  loop
    if v_cmd.object_type in ('table','trigger','function')
      and coalesce(v_cmd.schema_name,'') = 'public'
      and (
        v_cmd.object_identity like '%public.accounting_documents%'
        or v_cmd.object_identity like '%public.journal_entries%'
        or v_cmd.object_identity like '%public.journal_lines%'
      )
    then
      raise exception 'ledger ddl frozen';
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_freeze_ledger_tables;
create event trigger trg_freeze_ledger_tables
on ddl_command_end
when tag in ('ALTER TABLE','DROP TABLE','CREATE TRIGGER','ALTER TRIGGER','DROP TRIGGER','CREATE FUNCTION','ALTER FUNCTION','DROP FUNCTION')
execute function public.trg_freeze_ledger_tables();
