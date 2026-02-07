set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.financial_parties') is null then
    create table public.financial_parties (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      party_type text not null check (party_type in ('customer','supplier','employee','staff_custodian','partner','generic')),
      linked_entity_type text,
      linked_entity_id text,
      default_account_id uuid references public.chart_of_accounts(id) on delete set null,
      currency_preference text,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      updated_by uuid references auth.users(id) on delete set null
    );
    create unique index if not exists uq_financial_parties_linked_entity
      on public.financial_parties(linked_entity_type, linked_entity_id)
      where linked_entity_type is not null and btrim(linked_entity_type) <> ''
        and linked_entity_id is not null and btrim(linked_entity_id) <> '';
    create index if not exists idx_financial_parties_type_active on public.financial_parties(party_type, is_active);
    create index if not exists idx_financial_parties_name on public.financial_parties(name);
  end if;
end $$;

do $$
begin
  if to_regclass('public.financial_party_links') is null then
    create table public.financial_party_links (
      id uuid primary key default gen_random_uuid(),
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      role text not null check (role in ('customer','supplier','employee','staff_custodian','partner','generic')),
      linked_entity_type text not null,
      linked_entity_id text not null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (linked_entity_type, linked_entity_id, role)
    );
    create index if not exists idx_financial_party_links_party on public.financial_party_links(party_id);
    create index if not exists idx_financial_party_links_entity on public.financial_party_links(linked_entity_type, linked_entity_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.party_subledger_accounts') is null then
    create table public.party_subledger_accounts (
      account_id uuid primary key references public.chart_of_accounts(id) on delete restrict,
      role text not null check (role in ('ar','ap','deposits','employee_advance','custodian','other')),
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.currencies') is not null then
    begin
      alter table public.financial_parties
        drop constraint if exists financial_parties_currency_preference_fk;
      alter table public.financial_parties
        add constraint financial_parties_currency_preference_fk
        foreign key (currency_preference) references public.currencies(code)
        on update cascade on delete set null;
    exception when others then
      null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.set_updated_at') is not null then
    drop trigger if exists trg_financial_parties_updated_at on public.financial_parties;
    create trigger trg_financial_parties_updated_at
    before update on public.financial_parties
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.financial_parties enable row level security;
alter table public.financial_party_links enable row level security;
alter table public.party_subledger_accounts enable row level security;

drop policy if exists financial_parties_select on public.financial_parties;
create policy financial_parties_select
on public.financial_parties
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists financial_parties_write on public.financial_parties;
create policy financial_parties_write
on public.financial_parties
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists financial_party_links_select on public.financial_party_links;
create policy financial_party_links_select
on public.financial_party_links
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists financial_party_links_write on public.financial_party_links;
create policy financial_party_links_write
on public.financial_party_links
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists party_subledger_accounts_select on public.party_subledger_accounts;
create policy party_subledger_accounts_select
on public.party_subledger_accounts
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists party_subledger_accounts_write on public.party_subledger_accounts;
create policy party_subledger_accounts_write
on public.party_subledger_accounts
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.ensure_financial_party_for_customer(p_customer_auth_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_name text;
  v_currency text;
begin
  if p_customer_auth_user_id is null then
    return null;
  end if;

  select fpl.party_id
  into v_party_id
  from public.financial_party_links fpl
  where fpl.linked_entity_type = 'customers'
    and fpl.linked_entity_id = p_customer_auth_user_id::text
    and fpl.role = 'customer'
  limit 1;

  if v_party_id is not null then
    return v_party_id;
  end if;

  select
    coalesce(nullif(trim(c.full_name), ''), nullif(trim(c.email), ''), nullif(trim(c.phone_number), ''), p_customer_auth_user_id::text),
    nullif(trim(coalesce(c.preferred_currency, '')), '')
  into v_name, v_currency
  from public.customers c
  where c.auth_user_id = p_customer_auth_user_id;

  insert into public.financial_parties(name, party_type, linked_entity_type, linked_entity_id, currency_preference, created_by, updated_by)
  values (coalesce(v_name, p_customer_auth_user_id::text), 'customer', 'customers', p_customer_auth_user_id::text, v_currency, auth.uid(), auth.uid())
  returning id into v_party_id;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party_id, 'customer', 'customers', p_customer_auth_user_id::text, auth.uid())
  on conflict (linked_entity_type, linked_entity_id, role) do nothing;

  return v_party_id;
end;
$$;

create or replace function public.ensure_financial_party_for_supplier(p_supplier_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_name text;
  v_currency text;
begin
  if p_supplier_id is null then
    return null;
  end if;

  select fpl.party_id
  into v_party_id
  from public.financial_party_links fpl
  where fpl.linked_entity_type = 'suppliers'
    and fpl.linked_entity_id = p_supplier_id::text
    and fpl.role = 'supplier'
  limit 1;

  if v_party_id is not null then
    return v_party_id;
  end if;

  select
    coalesce(nullif(trim(s.name), ''), p_supplier_id::text),
    nullif(trim(coalesce(s.preferred_currency, '')), '')
  into v_name, v_currency
  from public.suppliers s
  where s.id = p_supplier_id;

  insert into public.financial_parties(name, party_type, linked_entity_type, linked_entity_id, currency_preference, created_by, updated_by)
  values (coalesce(v_name, p_supplier_id::text), 'supplier', 'suppliers', p_supplier_id::text, v_currency, auth.uid(), auth.uid())
  returning id into v_party_id;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party_id, 'supplier', 'suppliers', p_supplier_id::text, auth.uid())
  on conflict (linked_entity_type, linked_entity_id, role) do nothing;

  return v_party_id;
end;
$$;

create or replace function public.ensure_financial_party_for_employee(p_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_name text;
  v_currency text;
begin
  if p_employee_id is null then
    return null;
  end if;

  select fpl.party_id
  into v_party_id
  from public.financial_party_links fpl
  where fpl.linked_entity_type = 'payroll_employees'
    and fpl.linked_entity_id = p_employee_id::text
    and fpl.role = 'employee'
  limit 1;

  if v_party_id is not null then
    return v_party_id;
  end if;

  select
    coalesce(nullif(trim(e.full_name), ''), p_employee_id::text),
    nullif(trim(coalesce(e.currency, '')), '')
  into v_name, v_currency
  from public.payroll_employees e
  where e.id = p_employee_id;

  insert into public.financial_parties(name, party_type, linked_entity_type, linked_entity_id, currency_preference, created_by, updated_by)
  values (coalesce(v_name, p_employee_id::text), 'employee', 'payroll_employees', p_employee_id::text, v_currency, auth.uid(), auth.uid())
  returning id into v_party_id;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party_id, 'employee', 'payroll_employees', p_employee_id::text, auth.uid())
  on conflict (linked_entity_type, linked_entity_id, role) do nothing;

  return v_party_id;
end;
$$;

revoke all on function public.ensure_financial_party_for_customer(uuid) from public;
revoke all on function public.ensure_financial_party_for_supplier(uuid) from public;
revoke all on function public.ensure_financial_party_for_employee(uuid) from public;
grant execute on function public.ensure_financial_party_for_customer(uuid) to authenticated;
grant execute on function public.ensure_financial_party_for_supplier(uuid) to authenticated;
grant execute on function public.ensure_financial_party_for_employee(uuid) to authenticated;

do $$
begin
  if to_regclass('public.customers') is not null then
    create or replace function public.trg_customers_ensure_financial_party()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.ensure_financial_party_for_customer(new.auth_user_id);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_customers_ensure_financial_party on public.customers;
    create trigger trg_customers_ensure_financial_party
    after insert on public.customers
    for each row execute function public.trg_customers_ensure_financial_party();
  end if;
end $$;

do $$
begin
  if to_regclass('public.suppliers') is not null then
    create or replace function public.trg_suppliers_ensure_financial_party()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.ensure_financial_party_for_supplier(new.id);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_suppliers_ensure_financial_party on public.suppliers;
    create trigger trg_suppliers_ensure_financial_party
    after insert on public.suppliers
    for each row execute function public.trg_suppliers_ensure_financial_party();
  end if;
end $$;

do $$
begin
  if to_regclass('public.payroll_employees') is not null then
    create or replace function public.trg_payroll_employees_ensure_financial_party()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.ensure_financial_party_for_employee(new.id);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_payroll_employees_ensure_financial_party on public.payroll_employees;
    create trigger trg_payroll_employees_ensure_financial_party
    after insert on public.payroll_employees
    for each row execute function public.trg_payroll_employees_ensure_financial_party();
  end if;
end $$;

do $$
begin
  if to_regclass('public.chart_of_accounts') is null then
    return;
  end if;

  insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
  values
    ('1350', 'Employee Advances', 'asset', 'debit', true),
    ('1035', 'Custodian Cash', 'asset', 'debit', true),
    ('1210', 'Other Receivables', 'asset', 'debit', true),
    ('2110', 'Other Payables', 'liability', 'credit', true)
  on conflict (code) do update
  set name = excluded.name,
      account_type = excluded.account_type,
      normal_balance = excluded.normal_balance,
      is_active = true;
end $$;

do $$
declare
  v_ar uuid;
  v_ap uuid;
  v_dep uuid;
  v_adv uuid;
  v_cust uuid;
  v_other_ar uuid;
  v_other_ap uuid;
begin
  if to_regclass('public.party_subledger_accounts') is null then
    return;
  end if;

  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_dep := public.get_account_id_by_code('2050');
  v_adv := public.get_account_id_by_code('1350');
  v_cust := public.get_account_id_by_code('1035');
  v_other_ar := public.get_account_id_by_code('1210');
  v_other_ap := public.get_account_id_by_code('2110');

  if v_ar is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_ar, 'ar')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_ap is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_ap, 'ap')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_dep is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_dep, 'deposits')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_adv is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_adv, 'employee_advance')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_cust is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_cust, 'custodian')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_other_ar is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_other_ar, 'other')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
  if v_other_ap is not null then
    insert into public.party_subledger_accounts(account_id, role) values (v_other_ap, 'other')
    on conflict (account_id) do update set role = excluded.role, is_active = true;
  end if;
end $$;

do $$
declare
  r record;
begin
  if to_regclass('public.customers') is not null then
    for r in select c.auth_user_id as id from public.customers c
    loop
      perform public.ensure_financial_party_for_customer(r.id);
    end loop;
  end if;
  if to_regclass('public.suppliers') is not null then
    for r in select s.id as id from public.suppliers s
    loop
      perform public.ensure_financial_party_for_supplier(r.id);
    end loop;
  end if;
  if to_regclass('public.payroll_employees') is not null then
    for r in select e.id as id from public.payroll_employees e
    loop
      perform public.ensure_financial_party_for_employee(r.id);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
