-- 1) Currency Governance & Hyperinflation (YER)
do $$
begin
  if to_regclass('public.currencies') is not null then
    begin
      alter table public.currencies add column is_high_inflation boolean not null default false;
    exception when duplicate_column then null;
    end;
    update public.currencies set is_high_inflation = true where upper(code) = 'YER';
  end if;
end $$;

create or replace function public.get_base_currency()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_settings jsonb;
begin
  v_base := null;
  if to_regclass('public.app_settings') is not null then
    select s.data into v_settings
    from public.app_settings s
    where s.id in ('singleton','app')
    order by (s.id = 'singleton') desc
    limit 1;
    begin
      v_base := upper(nullif(btrim(coalesce(v_settings->'settings'->>'baseCurrency', '')), ''));
    exception when others then
      v_base := null;
    end;
  end if;
  if v_base is null then
    begin
      select upper(code) into v_base from public.currencies where is_base = true limit 1;
    exception when undefined_table then
      v_base := null;
    end;
  end if;
  if v_base is null then
    raise exception 'base currency not configured';
  end if;
  return v_base;
end;
$$;

-- 2) FX Accounts (Realized/Unrealized)
do $$
begin
  if to_regclass('public.chart_of_accounts') is not null then
    insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
    values ('6200', 'FX Gain Realized', 'income', 'credit', true)
    on conflict (code) do update set name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance, is_active = true;
    insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
    values ('6201', 'FX Loss Realized', 'expense', 'debit', true)
    on conflict (code) do update set name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance, is_active = true;
    insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
    values ('6250', 'FX Gain Unrealized', 'income', 'credit', true)
    on conflict (code) do update set name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance, is_active = true;
    insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
    values ('6251', 'FX Loss Unrealized', 'expense', 'debit', true)
    on conflict (code) do update set name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance, is_active = true;
  end if;
end $$;

-- 3) Purchase Orders Schema (Currency / FX / Base / Lock)
do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    begin
      alter table public.purchase_orders add column currency text;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.purchase_orders add column fx_rate numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.purchase_orders add column base_total numeric default 0;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.purchase_orders add column fx_locked boolean default false;
    exception when duplicate_column then null;
    end;
  end if;
  if to_regclass('public.purchase_items') is not null then
    begin
      alter table public.purchase_items add column unit_cost_foreign numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.purchase_items add column unit_cost_base numeric;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

create or replace function public.trg_purchase_items_set_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
begin
  select * into v_po from public.purchase_orders po where po.id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if v_po.id is null then
    raise exception 'purchase order not found';
  end if;
  if v_po.currency is null then
    raise exception 'purchase order currency missing';
  end if;
  if v_po.fx_rate is null then
    raise exception 'purchase order fx rate missing';
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if new.unit_cost_foreign is null then
      new.unit_cost_foreign := coalesce(new.unit_cost, 0);
    end if;
    new.unit_cost_base := coalesce(new.unit_cost_foreign, 0) * coalesce(v_po.fx_rate, 0);
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_items') is not null then
    drop trigger if exists trg_purchase_items_set_costs on public.purchase_items;
    create trigger trg_purchase_items_set_costs
    before insert or update of unit_cost, unit_cost_foreign, purchase_order_id
    on public.purchase_items
    for each row execute function public.trg_purchase_items_set_costs();
  end if;
end $$;

create or replace function public.trg_purchase_orders_fx_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
begin
  v_base := public.get_base_currency();
  if tg_op = 'INSERT' then
    if new.currency is null then
      raise exception 'currency required';
    end if;
    if new.fx_rate is null then
      raise exception 'fx rate required';
    end if;
    new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (new.status = 'completed') and (old.status is distinct from 'completed') then
      if new.currency is null or new.fx_rate is null then
        raise exception 'currency/fx_rate required to complete PO';
      end if;
      new.fx_locked := true;
    end if;
    if coalesce(old.fx_locked, false) = true then
      if new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate then
        raise exception 'fx locked: currency/fx_rate cannot change after completion';
      end if;
    end if;
    new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
    return new;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    drop trigger if exists trg_purchase_orders_fx_lock on public.purchase_orders;
    create trigger trg_purchase_orders_fx_lock
    before insert or update on public.purchase_orders
    for each row execute function public.trg_purchase_orders_fx_lock();
  end if;
end $$;

-- 4) Orders/Payments Governance (Require currency, lock FX)
do $$
begin
  if to_regclass('public.orders') is not null then
    begin
      alter table public.orders add column fx_locked boolean default true;
    exception when duplicate_column then null;
    end;
  end if;
  if to_regclass('public.payments') is not null then
    begin
      alter table public.payments add column fx_locked boolean default true;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

create or replace function public.trg_set_order_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
begin
  if new.currency is null then
    raise exception 'currency required';
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.fx_locked,true) then
    if new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate then
      raise exception 'fx locked: cannot change currency/fx_rate';
    end if;
  end if;
  new.base_total := coalesce(new.total, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

create or replace function public.trg_set_payment_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
begin
  if new.currency is null then
    raise exception 'currency required';
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.fx_locked,true) then
    if new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate then
      raise exception 'fx locked: cannot change currency/fx_rate';
    end if;
  end if;
  new.base_amount := coalesce(new.amount, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.orders') is not null then
    drop trigger if exists trg_set_order_fx on public.orders;
    create trigger trg_set_order_fx
    before insert or update on public.orders
    for each row execute function public.trg_set_order_fx();
  end if;
  if to_regclass('public.payments') is not null then
    drop trigger if exists trg_set_payment_fx on public.payments;
    create trigger trg_set_payment_fx
    before insert or update on public.payments
    for each row execute function public.trg_set_payment_fx();
  end if;
end $$;

-- 5) FX Realized in post_payment (AR/AP zeroing)
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
  v_ar uuid;
  v_ap uuid;
  v_deposits uuid;
  v_gain_real uuid;
  v_loss_real uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_order_id uuid;
  v_open_ar numeric;
  v_settle_ar numeric;
  v_po_id uuid;
  v_po_base_total numeric;
  v_po_paid_base numeric;
  v_settle_ap numeric;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  select * into v_pay from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  v_amount_base := coalesce(v_pay.base_amount, v_pay.amount, 0);

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_deposits := public.get_account_id_by_code('2050');
  v_gain_real := public.get_account_id_by_code('6200');
  v_loss_real := public.get_account_id_by_code('6201');

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;
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

    select coalesce(open_balance, 0) into v_open_ar
    from public.ar_open_items
    where invoice_id = v_order_id and status = 'open'
    limit 1;
    if v_open_ar is null then
      -- fallback: use order.base_total minus previous payments
      select coalesce(o.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount, p.amount))
        from public.payments p
        where p.reference_table = 'orders' and p.direction = 'in' and p.reference_id = v_order_id::text
          and p.id <> v_pay.id
      ), 0)
      into v_open_ar
      from public.orders o
      where o.id = v_order_id;
    end if;

    v_settle_ar := greatest(0, v_open_ar);

    if v_amount_base >= v_settle_ar then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable');
      if (v_amount_base - v_settle_ar) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_gain_real, 0, v_amount_base - v_settle_ar, 'FX Gain realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable'),
        (v_entry_id, v_loss_real, v_settle_ar - v_amount_base, 0, 'FX Loss realized');
    end if;

    update public.ar_open_items
    set status = 'closed', open_balance = 0, closed_at = v_pay.occurred_at
    where invoice_id = v_order_id and status = 'open';
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_po_id := nullif(v_pay.reference_id, '')::uuid;
    if v_po_id is null then
      raise exception 'invalid purchase order reference_id';
    end if;
    select coalesce(base_total, 0) into v_po_base_total from public.purchase_orders where id = v_po_id;
    select coalesce(sum(coalesce(p.base_amount, p.amount)), 0) into v_po_paid_base
    from public.payments p
    where p.reference_table = 'purchase_orders' and p.direction = 'out' and p.reference_id = v_po_id::text and p.id <> v_pay.id;
    v_settle_ap := greatest(0, v_po_base_total - coalesce(v_po_paid_base, 0));

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

    if v_amount_base >= v_settle_ap then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
      if (v_amount_base - v_settle_ap) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_loss_real, v_amount_base - v_settle_ap, 0, 'FX Loss realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid'),
        (v_entry_id, v_gain_real, 0, v_settle_ap - v_amount_base, 'FX Gain realized');
    end if;
    return;
  end if;
end;
$$;

revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;

-- 6) FX Revaluation (Unrealized) with Auto-Reversal
do $$
begin
  if to_regclass('public.fx_revaluation_audit') is null then
    create table public.fx_revaluation_audit (
      id uuid primary key default gen_random_uuid(),
      period_end date not null,
      entity_type text not null check (entity_type in ('AR','AP')),
      entity_id uuid not null,
      currency text not null,
      original_base numeric not null,
      revalued_base numeric not null,
      diff numeric not null,
      journal_entry_id uuid not null,
      reversal_journal_entry_id uuid,
      created_at timestamptz not null default now(),
      unique(period_end, entity_type, entity_id)
    );
  end if;
end $$;

create or replace function public.run_fx_revaluation(p_period_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gain_unreal uuid := public.get_account_id_by_code('6250');
  v_loss_unreal uuid := public.get_account_id_by_code('6251');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_ap uuid := public.get_account_id_by_code('2010');
  v_base text := public.get_base_currency();
  v_item record;
  v_rate numeric;
  v_revalued numeric;
  v_diff numeric;
  v_entry_id uuid;
  v_rev_entry_id uuid;
begin
  if p_period_end is null then
    raise exception 'period end required';
  end if;

  -- AR Open Items
  for v_item in
    select a.id,
           a.invoice_id as entity_id,
           coalesce(o.currency, v_base) as currency,
           coalesce(a.open_balance, 0) as original_base,
           coalesce(o.total, 0) as invoice_total_foreign,
           coalesce(o.base_total, coalesce(o.total,0) * coalesce(o.fx_rate,1)) as invoice_total_base
    from public.ar_open_items a
    join public.orders o on o.id = a.invoice_id
    where a.status = 'open'
  loop
    v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
    if v_rate is null then
      raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
    end if;
    if upper(v_item.currency) = upper(v_base) then
      continue;
    end if;
    -- Proportion of open to original base
    if coalesce(v_item.invoice_total_base, 0) <= 0 then
      continue;
    end if;
    -- Remaining foreign amount ≈ invoice_total_foreign × (open_balance / invoice_total_base)
    v_revalued := (v_item.invoice_total_foreign * (v_item.original_base / v_item.invoice_total_base)) * v_rate;
    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (p_period_end, concat('FX Revaluation AR ', v_item.entity_id::text), 'ar_open_items', v_item.id::text, concat('fx_reval:', p_period_end::text), auth.uid())
    returning id into v_entry_id;
    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_ar, v_diff, 0, 'Increase AR'), (v_entry_id, v_gain_unreal, 0, v_diff, 'Unrealized FX Gain');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_loss_unreal, abs(v_diff), 0, 'Unrealized FX Loss'), (v_entry_id, v_ar, 0, abs(v_diff), 'Decrease AR');
    end if;
    -- Auto-reversal next day
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (p_period_end + interval '1 day', concat('Reversal FX Revaluation AR ', v_item.entity_id::text), 'ar_open_items', v_item.id::text, concat('fx_reval_rev:', p_period_end::text), auth.uid())
    returning id into v_rev_entry_id;
    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_rev_entry_id, v_gain_unreal, v_diff, 0, 'Reverse Unrealized FX Gain'), (v_rev_entry_id, v_ar, 0, v_diff, 'Reverse Increase AR');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_rev_entry_id, v_ar, abs(v_diff), 0, 'Reverse Decrease AR'), (v_rev_entry_id, v_loss_unreal, 0, abs(v_diff), 'Reverse Unrealized FX Loss');
    end if;
    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AR', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;

  -- AP Open (Purchase Orders not fully paid)
  for v_item in
    select po.id as entity_id,
           coalesce(po.currency, v_base) as currency,
           greatest(0, coalesce(po.base_total, 0) - coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)) as original_base,
           coalesce(po.total_amount, 0) - coalesce((select sum(coalesce(p.amount,0)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0) as remaining_foreign
    from public.purchase_orders po
    where coalesce(po.base_total, 0) > coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)
  loop
    v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
    if v_rate is null then
      raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
    end if;
    if upper(v_item.currency) = upper(v_base) then
      continue;
    end if;
    v_revalued := greatest(0, v_item.remaining_foreign) * v_rate;
    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (p_period_end, concat('FX Revaluation AP ', v_item.entity_id::text), 'purchase_orders', v_item.entity_id::text, concat('fx_reval:', p_period_end::text), auth.uid())
    returning id into v_entry_id;
    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_loss_unreal, v_diff, 0, 'Unrealized FX Loss'), (v_entry_id, v_ap, 0, v_diff, 'Increase AP');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_ap, abs(v_diff), 0, 'Decrease AP'), (v_entry_id, v_gain_unreal, 0, abs(v_diff), 'Unrealized FX Gain');
    end if;
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (p_period_end + interval '1 day', concat('Reversal FX Revaluation AP ', v_item.entity_id::text), 'purchase_orders', v_item.entity_id::text, concat('fx_reval_rev:', p_period_end::text), auth.uid())
    returning id into v_rev_entry_id;
    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_rev_entry_id, v_ap, v_diff, 0, 'Reverse Increase AP'), (v_rev_entry_id, v_loss_unreal, 0, v_diff, 'Reverse Unrealized FX Loss');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_rev_entry_id, v_gain_unreal, abs(v_diff), 0, 'Reverse Unrealized FX Gain'), (v_rev_entry_id, v_ap, 0, abs(v_diff), 'Reverse Decrease AP');
    end if;
    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AP', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;
end;
$$;

revoke all on function public.run_fx_revaluation(date) from public;
grant execute on function public.run_fx_revaluation(date) to service_role, authenticated;

-- 7) Landed Cost Allocation Audit (minimal structure)
do $$
begin
  if to_regclass('public.landed_cost_audit') is null then
    create table public.landed_cost_audit (
      id uuid primary key default gen_random_uuid(),
      shipment_id uuid not null,
      total_expenses_base numeric not null,
      allocated_at timestamptz not null default now(),
      journal_entry_id uuid not null,
      unique (shipment_id)
    );
  end if;
end $$;

create or replace function public.allocate_landed_cost_to_inventory(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_expenses_base numeric;
  v_entry_id uuid;
  v_inventory uuid := public.get_account_id_by_code('1400'); -- inventory
  v_clearing uuid := public.get_account_id_by_code('2060'); -- landed cost clearing
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id required';
  end if;
  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;
  if v_total_expenses_base <= 0 then
    return;
  end if;
  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (current_date, concat('Landed cost allocation shipment ', p_shipment_id::text), 'import_shipments', p_shipment_id::text, 'landed_cost_allocation', auth.uid())
  returning id into v_entry_id;
  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry_id, v_inventory, v_total_expenses_base, 0, 'Capitalize landed cost'), (v_entry_id, v_clearing, 0, v_total_expenses_base, 'Clear landed cost');
  insert into public.landed_cost_audit(shipment_id, total_expenses_base, journal_entry_id)
  values (p_shipment_id, v_total_expenses_base, v_entry_id)
  on conflict (shipment_id) do nothing;
end;
$$;

revoke all on function public.allocate_landed_cost_to_inventory(uuid) from public;
grant execute on function public.allocate_landed_cost_to_inventory(uuid) to service_role, authenticated;

-- 8) Governance: Prevent missing currency/fx for financial docs via constraints
do $$
declare
  v_base text;
begin
  v_base := public.get_base_currency();

  if to_regclass('public.orders') is not null then
    update public.orders
    set currency = coalesce(currency, v_base),
        fx_rate = coalesce(fx_rate, 1),
        base_total = coalesce(base_total, coalesce(total, 0) * coalesce(fx_rate, 1))
    where currency is null or fx_rate is null or base_total is null;
    begin
      alter table public.orders
        add constraint orders_currency_check check (currency is not null);
    exception when duplicate_object then null;
    end;
  end if;
  if to_regclass('public.payments') is not null then
    update public.payments
    set currency = coalesce(currency, v_base),
        fx_rate = coalesce(fx_rate, 1),
        base_amount = coalesce(base_amount, coalesce(amount, 0) * coalesce(fx_rate, 1))
    where currency is null or fx_rate is null or base_amount is null;
    begin
      alter table public.payments
        add constraint payments_currency_check check (currency is not null);
    exception when duplicate_object then null;
    end;
  end if;
  if to_regclass('public.purchase_orders') is not null then
    update public.purchase_orders
    set currency = coalesce(currency, v_base),
        fx_rate = coalesce(fx_rate, 1),
        base_total = coalesce(base_total, coalesce(total_amount, 0) * coalesce(fx_rate, 1)),
        fx_locked = coalesce(fx_locked, false)
    where currency is null or fx_rate is null or base_total is null or fx_locked is null;
    begin
      alter table public.purchase_orders
        add constraint po_currency_check check (currency is not null);
    exception when duplicate_object then null;
    end;
  end if;
  if to_regclass('public.import_expenses') is not null then
    update public.import_expenses
    set currency = coalesce(currency, v_base),
        exchange_rate = coalesce(exchange_rate, 1)
    where currency is null or exchange_rate is null;
    begin
      alter table public.import_expenses
        add constraint import_expenses_currency_check check (currency is not null);
    exception when duplicate_object then null;
    end;
    begin
      alter table public.import_expenses
        add constraint import_expenses_exchange_rate_check check (exchange_rate is not null);
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Enforce single base currency and prevent changing base after postings exist
create or replace function public.trg_enforce_base_currency_singleton()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_postings boolean := false;
  v_other_base int := 0;
begin
  select exists(select 1 from public.journal_entries) into v_has_postings;
  if tg_op = 'INSERT' then
    if coalesce(new.is_base, false) then
      select count(*) into v_other_base from public.currencies where is_base = true;
      if v_other_base > 0 then
        if v_has_postings then
          raise exception 'cannot set another base currency after postings exist';
        else
          update public.currencies set is_base = false where is_base = true;
        end if;
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.is_base, false) <> coalesce(new.is_base, false) then
      if v_has_postings then
        raise exception 'cannot change base currency after postings exist';
      end if;
    end if;
    if coalesce(new.is_base, false) then
      update public.currencies set is_base = false where code <> new.code and is_base = true;
    end if;
    return new;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.currencies') is not null then
    drop trigger if exists trg_enforce_base_currency_singleton on public.currencies;
    create trigger trg_enforce_base_currency_singleton
    before insert or update on public.currencies
    for each row execute function public.trg_enforce_base_currency_singleton();
  end if;
end $$;

notify pgrst, 'reload schema';
