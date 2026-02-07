set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.party_open_items') is null then
    create table public.party_open_items (
      id uuid primary key default gen_random_uuid(),
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
      journal_line_id uuid not null references public.journal_lines(id) on delete restrict,
      account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
      direction text not null check (direction in ('debit','credit')),
      occurred_at timestamptz not null,
      due_date date,
      item_role text,
      item_type text not null,
      source_table text,
      source_id text,
      source_event text,
      party_document_id uuid references public.party_documents(id) on delete set null,
      currency_code text not null,
      foreign_amount numeric,
      base_amount numeric not null,
      open_foreign_amount numeric,
      open_base_amount numeric not null,
      status text not null default 'open' check (status in ('open','partially_settled','settled')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists uq_party_open_items_line on public.party_open_items(journal_line_id);
    create index if not exists idx_party_open_items_party on public.party_open_items(party_id, status, occurred_at desc);
    create index if not exists idx_party_open_items_party_currency on public.party_open_items(party_id, currency_code, status, occurred_at desc);
    create index if not exists idx_party_open_items_due on public.party_open_items(party_id, due_date, status);
    create index if not exists idx_party_open_items_account on public.party_open_items(account_id, status);
    create index if not exists idx_party_open_items_party_role on public.party_open_items(party_id, item_role, status);
  end if;
end $$;

alter table public.party_open_items enable row level security;

drop policy if exists party_open_items_select on public.party_open_items;
create policy party_open_items_select on public.party_open_items
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists party_open_items_update on public.party_open_items;
create policy party_open_items_update on public.party_open_items
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists party_open_items_insert_none on public.party_open_items;
create policy party_open_items_insert_none on public.party_open_items
for insert
with check (false);

drop policy if exists party_open_items_delete_none on public.party_open_items;
create policy party_open_items_delete_none on public.party_open_items
for delete
using (false);

create or replace function public.trg_party_open_items_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.party_open_items') is not null then
    drop trigger if exists trg_party_open_items_touch_updated_at on public.party_open_items;
    create trigger trg_party_open_items_touch_updated_at
    before update on public.party_open_items
    for each row execute function public.trg_party_open_items_touch_updated_at();
  end if;
end $$;

do $$
begin
  if to_regclass('public.settlement_headers') is null then
    create table public.settlement_headers (
      id uuid primary key default gen_random_uuid(),
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      settlement_date timestamptz not null,
      currency_code text,
      status text not null default 'posted' check (status in ('posted')),
      settlement_type text not null default 'normal' check (settlement_type in ('normal','reversal')),
      reverses_settlement_id uuid references public.settlement_headers(id) on delete restrict,
      created_by uuid references auth.users(id) on delete set null,
      notes text,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_settlement_headers_party on public.settlement_headers(party_id, settlement_date desc);
    create index if not exists idx_settlement_headers_reverses on public.settlement_headers(reverses_settlement_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.settlement_lines') is null then
    create table public.settlement_lines (
      id uuid primary key default gen_random_uuid(),
      settlement_id uuid not null references public.settlement_headers(id) on delete restrict,
      from_open_item_id uuid not null references public.party_open_items(id) on delete restrict,
      to_open_item_id uuid not null references public.party_open_items(id) on delete restrict,
      allocated_foreign_amount numeric,
      allocated_base_amount numeric not null,
      allocated_counter_base_amount numeric not null,
      fx_rate numeric,
      counter_fx_rate numeric,
      realized_fx_amount numeric not null default 0,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_settlement_lines_settlement on public.settlement_lines(settlement_id);
    create index if not exists idx_settlement_lines_from on public.settlement_lines(from_open_item_id);
    create index if not exists idx_settlement_lines_to on public.settlement_lines(to_open_item_id);
  end if;
end $$;

alter table public.settlement_headers enable row level security;
alter table public.settlement_lines enable row level security;

drop policy if exists settlement_headers_select on public.settlement_headers;
create policy settlement_headers_select on public.settlement_headers
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists settlement_headers_insert on public.settlement_headers;
create policy settlement_headers_insert on public.settlement_headers
for insert
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists settlement_headers_update_none on public.settlement_headers;
create policy settlement_headers_update_none on public.settlement_headers
for update
using (false);

drop policy if exists settlement_headers_delete_none on public.settlement_headers;
create policy settlement_headers_delete_none on public.settlement_headers
for delete
using (false);

drop policy if exists settlement_lines_select on public.settlement_lines;
create policy settlement_lines_select on public.settlement_lines
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists settlement_lines_insert on public.settlement_lines;
create policy settlement_lines_insert on public.settlement_lines
for insert
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists settlement_lines_update_none on public.settlement_lines;
create policy settlement_lines_update_none on public.settlement_lines
for update
using (false);

drop policy if exists settlement_lines_delete_none on public.settlement_lines;
create policy settlement_lines_delete_none on public.settlement_lines
for delete
using (false);

create or replace function public.trg_settlement_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'immutable_record';
end;
$$;

do $$
begin
  if to_regclass('public.settlement_headers') is not null then
    drop trigger if exists trg_settlement_headers_immutable on public.settlement_headers;
    create trigger trg_settlement_headers_immutable
    before update or delete on public.settlement_headers
    for each row execute function public.trg_settlement_immutable();
  end if;
  if to_regclass('public.settlement_lines') is not null then
    drop trigger if exists trg_settlement_lines_immutable on public.settlement_lines;
    create trigger trg_settlement_lines_immutable
    before update or delete on public.settlement_lines
    for each row execute function public.trg_settlement_immutable();
  end if;
end $$;

notify pgrst, 'reload schema';

