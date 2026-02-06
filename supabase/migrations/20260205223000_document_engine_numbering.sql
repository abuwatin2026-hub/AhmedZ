select set_config('app.allow_ledger_ddl', '1', true);

do $$
begin
  if to_regclass('public.document_sequences') is null then
    create table public.document_sequences (
      doc_type text not null,
      branch_id uuid not null references public.branches(id) on delete cascade,
      year integer not null,
      last_number integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (doc_type, branch_id, year)
    );
  end if;
end $$;

alter table public.accounting_documents
  add column if not exists document_number text,
  add column if not exists print_count integer not null default 0,
  add column if not exists last_printed_at timestamptz,
  add column if not exists last_printed_template text,
  add column if not exists data jsonb not null default '{}'::jsonb;

alter table public.purchase_receipts
  add column if not exists grn_number text;

create unique index if not exists idx_purchase_receipts_grn_number_unique
  on public.purchase_receipts(grn_number)
  where grn_number is not null and length(btrim(grn_number)) > 0;

create or replace function public._doc_prefix(p_doc_type text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  case lower(coalesce(p_doc_type, ''))
    when 'invoice' then return 'INV';
    when 'po' then return 'PO';
    when 'grn' then return 'GRN';
    when 'transfer' then return 'TRF';
    when 'payment' then return 'PAY';
    when 'receipt' then return 'RCV';
    when 'journal' then return 'JV';
    when 'manual' then return 'JV';
    when 'movement' then return 'MV';
    else return upper(coalesce(p_doc_type, 'DOC'));
  end case;
end;
$$;

create or replace function public.next_document_sequence(
  p_doc_type text,
  p_branch_id uuid,
  p_doc_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_new integer;
begin
  if p_branch_id is null then
    raise exception 'branch_id is required';
  end if;
  v_year := extract(year from coalesce(p_doc_date, current_date))::integer;

  insert into public.document_sequences(doc_type, branch_id, year, last_number, updated_at)
  values (lower(coalesce(p_doc_type, 'doc')), p_branch_id, v_year, 1, now())
  on conflict (doc_type, branch_id, year)
  do update set
    last_number = public.document_sequences.last_number + 1,
    updated_at = now()
  returning last_number into v_new;

  return v_new;
end;
$$;

create or replace function public.format_document_number(
  p_doc_type text,
  p_branch_id uuid,
  p_doc_date date,
  p_seq integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_branch_code text;
  v_year text;
begin
  v_prefix := public._doc_prefix(p_doc_type);
  select b.code into v_branch_code from public.branches b where b.id = p_branch_id;
  v_branch_code := upper(coalesce(nullif(trim(v_branch_code), ''), 'BR'));
  v_year := to_char(coalesce(p_doc_date, current_date), 'YYYY');
  return concat(v_prefix, '-', v_branch_code, '-', v_year, '-', lpad(greatest(coalesce(p_seq, 0), 0)::text, 6, '0'));
end;
$$;

create or replace function public.next_document_number(
  p_doc_type text,
  p_branch_id uuid,
  p_doc_date date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  v_seq := public.next_document_sequence(p_doc_type, p_branch_id, p_doc_date);
  return public.format_document_number(p_doc_type, p_branch_id, p_doc_date, v_seq);
end;
$$;

create or replace function public._assign_po_number_v2(p_branch_id uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_branch_id is null then
    return concat('PO-', to_char(coalesce(p_date, current_date), 'YYMMDD'), '-', lpad(nextval('public.purchase_order_number_seq'::regclass)::text, 6, '0'));
  end if;
  return public.next_document_number('po', p_branch_id, coalesce(p_date, current_date));
end;
$$;

create or replace function public._trg_purchase_orders_po_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.po_number is null or length(btrim(new.po_number)) = 0 then
    new.po_number := public._assign_po_number_v2(new.branch_id, new.purchase_date);
  end if;
  if new.reference_number is not null and length(btrim(new.reference_number)) = 0 then
    new.reference_number := null;
  end if;
  return new;
end;
$$;

create or replace function public._assign_grn_number_v2(p_branch_id uuid, p_received_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_branch_id is null then
    return concat('GRN-', to_char(coalesce(p_received_at, now())::date, 'YYMMDD'), '-', lpad((extract(epoch from coalesce(p_received_at, now()))::bigint % 1000000)::text, 6, '0'));
  end if;
  return public.next_document_number('grn', p_branch_id, coalesce(p_received_at, now())::date);
end;
$$;

create or replace function public._trg_purchase_receipts_grn_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.grn_number is null or length(btrim(new.grn_number)) = 0 then
    new.grn_number := public._assign_grn_number_v2(new.branch_id, new.received_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_receipts_grn_number on public.purchase_receipts;
create trigger trg_purchase_receipts_grn_number
before insert or update on public.purchase_receipts
for each row execute function public._trg_purchase_receipts_grn_number();

create or replace function public.ensure_accounting_document_number(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_num text;
  v_date date;
begin
  if p_document_id is null then
    raise exception 'document id is required';
  end if;

  select * into v_doc
  from public.accounting_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'accounting document not found';
  end if;

  if v_doc.document_number is not null and length(btrim(v_doc.document_number)) > 0 then
    return v_doc.document_number;
  end if;

  if v_doc.document_type = 'invoice' and v_doc.source_table = 'orders' then
    select nullif(o.invoice_number,'') into v_num
    from public.orders o
    where o.id = v_doc.source_id::uuid;
    if v_num is not null and length(btrim(v_num)) > 0 then
      update public.accounting_documents set document_number = v_num where id = v_doc.id;
      return v_num;
    end if;
  end if;

  v_date := current_date;
  if v_doc.source_table = 'purchase_orders' then
    select coalesce(po.purchase_date, current_date) into v_date
    from public.purchase_orders po
    where po.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'purchase_receipts' then
    select coalesce(pr.received_at::date, current_date) into v_date
    from public.purchase_receipts pr
    where pr.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'payments' then
    select coalesce(p.occurred_at::date, current_date) into v_date
    from public.payments p
    where p.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'warehouse_transfers' then
    select coalesce(wt.transfer_date, current_date) into v_date
    from public.warehouse_transfers wt
    where wt.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'inventory_transfers' then
    select coalesce(it.transfer_date, current_date) into v_date
    from public.inventory_transfers it
    where it.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'inventory_movements' then
    select coalesce(im.occurred_at::date, current_date) into v_date
    from public.inventory_movements im
    where im.id = v_doc.source_id::uuid;
  end if;

  v_num := public.next_document_number(v_doc.document_type, v_doc.branch_id, v_date);
  update public.accounting_documents set document_number = v_num where id = v_doc.id;
  return v_num;
end;
$$;

create or replace function public.mark_accounting_document_printed(
  p_document_id uuid,
  p_template text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  update public.accounting_documents
  set print_count = print_count + 1,
      last_printed_at = now(),
      last_printed_template = nullif(btrim(coalesce(p_template,'')),'')
  where id = p_document_id;

  select * into v_doc from public.accounting_documents where id = p_document_id;
  if found then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'print',
      'documents',
      concat('Printed document ', coalesce(v_doc.document_number, v_doc.id::text)),
      auth.uid(),
      now(),
      jsonb_build_object(
        'documentId', v_doc.id,
        'documentType', v_doc.document_type,
        'documentNumber', v_doc.document_number,
        'sourceTable', v_doc.source_table,
        'sourceId', v_doc.source_id,
        'template', nullif(btrim(coalesce(p_template,'')),'')
      )
    );
  end if;
end;
$$;
