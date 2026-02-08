set app.allow_ledger_ddl = '1';

create or replace function public.receive_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pi record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_batch_id uuid;
  v_wh uuid;
  v_category text;
  v_unit_cost_base numeric;
begin
  perform public._require_staff('receive_purchase_order');

  if p_order_id is null then
    raise exception 'purchase order not found';
  end if;

  v_wh := public._resolve_default_warehouse_id();
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  for v_pi in
    select
      pi.item_id,
      pi.quantity,
      coalesce(pi.unit_cost_base, pi.unit_cost, 0) as unit_cost_base
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    v_unit_cost_base := coalesce(v_pi.unit_cost_base, 0);

    select mi.category
    into v_category
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    if coalesce(v_category,'') = 'food' then
      raise exception 'expiryDate is required for food item % (use partial receiving)', v_pi.item_id;
    end if;

    v_batch_id := gen_random_uuid();

    insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_pi.item_id, v_wh, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_pi.item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_pi.item_id::text
      and sm.warehouse_id = v_wh
    for update;

    select (v_unit_cost_base + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    v_new_qty := v_old_qty + v_pi.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_pi.quantity * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_pi.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_pi.item_id::text
      and warehouse_id = v_wh;

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_pi.item_id::text, v_batch_id, v_wh, v_pi.quantity, null)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      updated_at = now();

    update public.menu_items
    set buying_price = v_unit_cost_base,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_pi.item_id, 'purchase_in', v_pi.quantity, v_effective_unit_cost, (v_pi.quantity * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('purchaseOrderId', p_order_id, 'batchId', v_batch_id, 'warehouseId', v_wh),
      v_batch_id, v_wh
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  update public.purchase_orders
  set status = 'completed',
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.check_journal_entry_balance(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_count int;
  v_je record;
  v_base text;
begin
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0),
    count(1)
  into v_debit, v_credit, v_count
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_count < 2 then
    raise exception 'journal entry must have at least 2 lines %', p_entry_id;
  end if;

  if abs((v_debit - v_credit)) > 1e-6 then
    raise exception 'journal entry not balanced % (debit %, credit %)', p_entry_id, v_debit, v_credit;
  end if;

  select
    je.source_table,
    je.source_event,
    je.currency_code,
    je.fx_rate,
    je.foreign_amount
  into v_je
  from public.journal_entries je
  where je.id = p_entry_id;

  v_base := public.get_base_currency();

  if v_je.currency_code is not null
     and nullif(btrim(v_je.currency_code), '') is not null
     and upper(v_je.currency_code) <> upper(v_base)
     and coalesce(v_je.fx_rate, 0) > 0
     and coalesce(v_je.foreign_amount, 0) > 0
     and coalesce(v_je.source_table, '') in ('orders','payments','sales_returns','inventory_movements','expenses','import_expenses')
     and coalesce(v_je.source_event, '') not in ('reval','reversal')
  then
    if abs(v_debit - (v_je.foreign_amount * v_je.fx_rate)) > 0.01 then
      raise exception 'journal entry fx mismatch % (debit %, foreign %, rate %)', p_entry_id, v_debit, v_je.foreign_amount, v_je.fx_rate;
    end if;
  end if;
end;
$$;

do $$
declare
  v_base text;
  r record;
  v_rev_id uuid;
  v_fix_id uuid;
  v_rev_source_id uuid;
  v_fix_source_id uuid;

  v_currency text;
  v_fx numeric;
  v_total_foreign numeric;
  v_total_base numeric;
  v_deposits_paid_base numeric;
  v_ar_amount_base numeric;
  v_delivery_base numeric;
  v_tax_base numeric;
  v_accounts jsonb;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  v_cutoff timestamptz;

  v_cash uuid;
  v_bank uuid;
  v_ar_acct uuid;
  v_deposits_acct uuid;
  v_ap uuid;
  v_expenses uuid;
  v_clearing uuid;
  v_fx_gain uuid;
  v_fx_loss uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_amount_fx numeric;
  v_rate numeric;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_has_accrual boolean;
  v_outstanding_base numeric;
  v_settle_base numeric;
  v_diff numeric;
  v_po_id uuid;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;
  v_source_entry_id uuid;
  v_original_ar_base numeric;
  v_settled_ar_base numeric;

  v_entry_total numeric;
begin
  perform set_config('request.jwt.claims', '', true);

  v_base := public.get_base_currency();

  select s.data->'accounting_accounts' into v_accounts from public.app_settings s where s.id = 'singleton';
  v_ar := public.get_account_id_by_code(coalesce(v_accounts->>'ar','1200'));
  v_deposits := public.get_account_id_by_code(coalesce(v_accounts->>'deposits','2050'));
  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar_acct := public.get_account_id_by_code('1200');
  v_deposits_acct := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');
  v_fx_gain := public.get_account_id_by_code('6200');
  v_fx_loss := public.get_account_id_by_code('6201');

  for r in
    select
      je.id as entry_id,
      je.entry_date,
      je.document_id,
      je.branch_id,
      je.company_id,
      je.source_event,
      o.id as order_id,
      upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) as currency,
      coalesce(o.fx_rate, nullif((o.data->>'fxRate')::numeric, null), 1) as fx_rate,
      coalesce(o.total, 0) as total_foreign_col,
      coalesce(o.base_total, 0) as base_total,
      o.data as order_data,
      coalesce(sum(jl.debit), 0) as entry_total
    from public.orders o
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = o.id::text
     and je.source_event in ('delivered','invoiced')
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) <> upper(v_base)
      and coalesce(o.base_total, 0) > 0
    group by je.id, je.entry_date, je.document_id, je.branch_id, je.company_id, je.source_event, o.id, o.currency, o.fx_rate, o.total, o.base_total, o.data
  loop
    v_total_base := coalesce(r.base_total, 0);
    if v_total_base <= 0 then
      continue;
    end if;

    begin
      v_total_foreign := coalesce(
        nullif((r.order_data->'invoiceSnapshot'->>'total')::numeric, null),
        nullif((r.order_data->>'total')::numeric, null),
        coalesce(r.total_foreign_col, 0),
        0
      );
    exception when others then
      v_total_foreign := coalesce(r.total_foreign_col, 0);
    end;

    if v_total_foreign <= 0 then
      continue;
    end if;

    v_entry_total := coalesce(r.entry_total, 0);
    if abs(v_entry_total - v_total_foreign) > 0.01 then
      continue;
    end if;
    if abs(v_entry_total - v_total_base) <= 0.01 then
      continue;
    end if;

    v_currency := upper(coalesce(nullif(btrim(r.currency), ''), v_base));
    v_fx := coalesce(r.fx_rate, 1);
    if v_fx <= 0 then
      continue;
    end if;

    v_cutoff := r.entry_date;

    select coalesce(sum(coalesce(p.base_amount, 0)), 0)
    into v_deposits_paid_base
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = r.order_id::text
      and p.direction = 'in'
      and p.occurred_at < coalesce(v_cutoff, now());

    v_deposits_paid_base := least(v_total_base, greatest(0, coalesce(v_deposits_paid_base, 0)));
    v_ar_amount_base := greatest(0, v_total_base - v_deposits_paid_base);

    begin
      v_delivery_base := coalesce(nullif((r.order_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), nullif((r.order_data->>'deliveryFee')::numeric, null), 0) * v_fx;
    exception when others then
      v_delivery_base := 0;
    end;
    begin
      v_tax_base := coalesce(nullif((r.order_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), nullif((r.order_data->>'taxAmount')::numeric, null), 0) * v_fx;
    exception when others then
      v_tax_base := 0;
    end;
    v_tax_base := least(greatest(0, v_tax_base), v_total_base);
    v_delivery_base := least(greatest(0, v_delivery_base), v_total_base - v_tax_base);

    v_rev_source_id := public.uuid_from_text(concat('fxfix:orders:rev:', r.entry_id::text));
    v_fix_source_id := public.uuid_from_text(concat('fxfix:orders:repost:', r.entry_id::text));

    if exists (
      select 1 from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_order_fx'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Reverse (fx fix) order ', r.order_id::text, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_order_fx',
      null,
      'posted',
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    select v_rev_id, jl.account_id, jl.credit, jl.debit, concat('Reverse ', coalesce(jl.line_memo,''))
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Repost (fx fix) order ', r.order_id::text, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_order_fx',
      null,
      'posted',
      case when v_currency <> v_base then v_currency else null end,
      case when v_currency <> v_base then v_fx else null end,
      case when v_currency <> v_base then v_total_foreign else null end,
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_fix_id;

    if v_deposits_paid_base > 0 and v_deposits is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_deposits, v_deposits_paid_base, 0, 'Apply customer deposit (base fx fix)');
    end if;
    if v_ar_amount_base > 0 and v_ar is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_ar, v_ar_amount_base, 0, 'Accounts receivable (base fx fix)');
    end if;
    if (v_total_base - v_delivery_base - v_tax_base) > 0 and v_sales is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_sales, 0, (v_total_base - v_delivery_base - v_tax_base), 'Sales revenue (base fx fix)');
    end if;
    if v_delivery_base > 0 and v_delivery_income is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_delivery_income, 0, v_delivery_base, 'Delivery income (base fx fix)');
    end if;
    if v_tax_base > 0 and v_vat_payable is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_vat_payable, 0, v_tax_base, 'VAT payable (base fx fix)');
    end if;

    perform public.check_journal_entry_balance(v_fix_id);
    if r.source_event = 'invoiced' then
      perform public.sync_ar_on_invoice(r.order_id);
    end if;
  end loop;

  for r in
    select
      je.id as entry_id,
      je.entry_date,
      je.document_id,
      je.branch_id,
      je.company_id,
      p.id as payment_id,
      p.direction,
      p.method,
      p.reference_table,
      p.reference_id,
      p.occurred_at,
      upper(coalesce(nullif(btrim(p.currency), ''), v_base)) as currency,
      coalesce(p.fx_rate, 1) as fx_rate,
      coalesce(p.amount, 0) as amount_fx,
      coalesce(p.base_amount, 0) as amount_base,
      max(case when jl.account_id in (v_cash, v_bank) then greatest(coalesce(jl.debit,0), coalesce(jl.credit,0)) else null end) as cash_bank_amount
    from public.payments p
    join public.journal_entries je
      on je.source_table = 'payments'
     and je.source_id = p.id::text
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    where upper(coalesce(nullif(btrim(p.currency), ''), v_base)) <> upper(v_base)
      and coalesce(p.base_amount, 0) > 0
      and coalesce(p.reference_table, '') <> 'sales_returns'
    group by je.id, je.entry_date, je.document_id, je.branch_id, je.company_id, p.id, p.direction, p.method, p.reference_table, p.reference_id, p.occurred_at, p.currency, p.fx_rate, p.amount, p.base_amount
  loop
    if r.cash_bank_amount is null then
      continue;
    end if;
    if abs(r.cash_bank_amount - r.amount_fx) > 0.01 then
      continue;
    end if;
    if abs(r.cash_bank_amount - r.amount_base) <= 0.01 then
      continue;
    end if;

    v_fix_source_id := public.uuid_from_text(concat('fxfix:payments:repost:', r.entry_id::text));
    v_rev_source_id := public.uuid_from_text(concat('fxfix:payments:rev:', r.entry_id::text));

    if exists (
      select 1 from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_payment_fx'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Reverse (fx fix) payment ', r.payment_id::text, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_payment_fx',
      null,
      'posted',
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    select v_rev_id, jl.account_id, jl.credit, jl.debit, concat('Reverse ', coalesce(jl.line_memo,'')), jl.currency_code, jl.fx_rate, jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    v_currency := upper(coalesce(nullif(btrim(r.currency), ''), v_base));
    v_rate := coalesce(r.fx_rate, 1);
    v_amount_fx := coalesce(r.amount_fx, 0);
    v_amount_base := coalesce(r.amount_base, 0);
    if v_amount_base <= 0 then
      continue;
    end if;

    v_cash_fx_code := null;
    v_cash_fx_rate := null;
    v_cash_fx_amount := null;
    if v_currency <> v_base then
      v_cash_fx_code := v_currency;
      v_cash_fx_rate := v_rate;
      v_cash_fx_amount := v_amount_fx;
    end if;

    if r.method = 'cash' then
      v_debit_account := v_cash;
      v_credit_account := v_cash;
    else
      v_debit_account := v_bank;
      v_credit_account := v_bank;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Repost (fx fix) payment ', r.direction, ' ', r.reference_table, ':', r.reference_id, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_payment_fx',
      null,
      'posted',
      case when v_currency <> v_base then v_currency else null end,
      case when v_currency <> v_base then v_rate else null end,
      case when v_currency <> v_base then v_amount_fx else null end,
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_fix_id;

    if r.direction = 'in' and r.reference_table = 'orders' then
      begin
        v_order_id := nullif(r.reference_id, '')::uuid;
      exception when others then
        v_order_id := null;
      end;
      if v_order_id is null then
        continue;
      end if;

      v_delivered_at := public.order_delivered_at(v_order_id);
      if v_delivered_at is null or r.occurred_at < v_delivered_at then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_deposits_acct, 0, v_amount_base, 'Customer deposit (base fx fix)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;

      select je.id
      into v_source_entry_id
      from public.journal_entries je
      where je.source_table = 'orders'
        and je.source_id = v_order_id::text
        and je.source_event in ('invoiced','delivered')
      order by
        case when je.source_event = 'invoiced' then 0 else 1 end asc,
        je.entry_date desc
      limit 1;

      if v_source_entry_id is null then
        select coalesce(o.base_total, 0)
        into v_original_ar_base
        from public.orders o
        where o.id = v_order_id;
      else
        select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
        into v_original_ar_base
        from public.journal_lines jl
        where jl.journal_entry_id = v_source_entry_id
          and jl.account_id = v_ar_acct;
      end if;

      select coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
      into v_settled_ar_base
      from public.payments p
      join public.journal_entries je
        on je.source_table = 'payments'
       and je.source_id = p.id::text
      join public.journal_lines jl
        on jl.journal_entry_id = je.id
      where p.reference_table = 'orders'
        and p.direction = 'in'
        and p.reference_id = v_order_id::text
        and p.id <> r.payment_id
        and jl.account_id = v_ar_acct;

      v_outstanding_base := greatest(0, coalesce(v_original_ar_base, 0) - coalesce(v_settled_ar_base, 0));

      if v_outstanding_base <= 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_deposits_acct, 0, v_amount_base, 'Customer deposit (base fx fix)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;

      v_settle_base := v_outstanding_base;
      v_diff := v_amount_base - v_settle_base;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_debit_account, v_amount_base, 0, 'Receive payment (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
        (v_fix_id, v_ar_acct, 0, v_settle_base, 'Settle receivable (base fx fix)', null, null, null);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized (fx fix)');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized (fx fix)');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'purchase_orders' then
      begin
        v_po_id := nullif(r.reference_id, '')::uuid;
      exception when others then
        v_po_id := null;
      end;
      if v_po_id is null then
        continue;
      end if;

      select greatest(0, coalesce(po.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount, 0))
        from public.payments p
        where p.reference_table = 'purchase_orders'
          and p.direction = 'out'
          and p.reference_id = v_po_id::text
          and p.id <> r.payment_id
          and p.occurred_at <= r.occurred_at
      ), 0))
      into v_outstanding_base
      from public.purchase_orders po
      where po.id = v_po_id;

      v_settle_base := least(greatest(0, v_outstanding_base), v_amount_base);
      v_diff := 0;
      if v_outstanding_base > 0 and (v_amount_base + 0.0000001) >= v_outstanding_base then
        v_diff := v_amount_base - v_outstanding_base;
        v_settle_base := v_outstanding_base;
      end if;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_ap, v_settle_base, 0, 'Settle payable (base fx fix)', null, null, null),
        (v_fix_id, v_credit_account, 0, v_amount_base, 'Pay supplier (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized (fx fix)');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized (fx fix)');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'expenses' then
      v_has_accrual := exists(
        select 1 from public.journal_entries je
        where je.source_table = 'expenses'
          and je.source_id = coalesce(r.reference_id, '')
          and je.source_event = 'accrual'
      );
      if v_has_accrual then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (base fx fix)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_expenses, v_amount_base, 0, 'Operating expense (base fx fix)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'import_expenses' then
      v_has_accrual := exists(
        select 1 from public.journal_entries je
        where je.source_table = 'import_expenses'
          and je.source_id = coalesce(r.reference_id, '')
          and je.source_event = 'accrual'
      );
      if v_has_accrual then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (base fx fix)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_clearing, v_amount_base, 0, 'Landed cost service (base fx fix)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (base fx fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;
  end loop;

  for r in
    select
      je.id as entry_id,
      je.entry_date,
      je.document_id,
      je.branch_id,
      je.company_id,
      im.id as movement_id,
      im.total_cost as total_cost_foreign,
      po.id as po_id,
      upper(coalesce(nullif(btrim(po.currency),''), v_base)) as currency,
      coalesce(po.fx_rate, 1) as fx_rate,
      coalesce(sum(jl.debit), 0) as entry_total
    from public.inventory_movements im
    join public.purchase_orders po
      on po.id::text = im.reference_id
    join public.journal_entries je
      on je.source_table = 'inventory_movements'
     and je.source_id = im.id::text
     and je.source_event = im.movement_type
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    where im.movement_type = 'purchase_in'
      and im.reference_table = 'purchase_orders'
      and upper(coalesce(nullif(btrim(po.currency),''), v_base)) <> upper(v_base)
      and coalesce(po.fx_rate, 0) > 0
      and coalesce(im.total_cost, 0) > 0
    group by je.id, je.entry_date, je.document_id, je.branch_id, je.company_id, im.id, im.total_cost, po.id, po.currency, po.fx_rate
  loop
    v_entry_total := coalesce(r.entry_total, 0);
    if abs(v_entry_total - coalesce(r.total_cost_foreign, 0)) > 0.01 then
      continue;
    end if;
    if abs(v_entry_total - (coalesce(r.total_cost_foreign, 0) * coalesce(r.fx_rate, 1))) <= 0.01 then
      continue;
    end if;

    v_fx := coalesce(r.fx_rate, 1);
    v_currency := upper(coalesce(nullif(btrim(r.currency), ''), v_base));
    if v_fx <= 0 or v_currency = v_base then
      continue;
    end if;

    v_fix_source_id := public.uuid_from_text(concat('fxfix:inv:repost:', r.entry_id::text));
    v_rev_source_id := public.uuid_from_text(concat('fxfix:inv:rev:', r.entry_id::text));

    if exists (
      select 1 from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_inventory_fx'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Reverse (fx fix) inventory movement ', r.movement_id::text, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_inventory_fx',
      null,
      'posted',
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    select v_rev_id, jl.account_id, jl.credit, jl.debit, concat('Reverse ', coalesce(jl.line_memo,''))
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Repost (fx fix) inventory movement ', r.movement_id::text, ' entry ', r.entry_id::text),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_inventory_fx',
      null,
      'posted',
      v_currency,
      v_fx,
      coalesce(r.total_cost_foreign, 0),
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_fix_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    select
      v_fix_id,
      jl.account_id,
      public._money_round(coalesce(jl.debit,0) * v_fx),
      public._money_round(coalesce(jl.credit,0) * v_fx),
      concat('Base fx fix ', coalesce(jl.line_memo,'')),
      v_currency,
      v_fx,
      greatest(coalesce(jl.debit,0), coalesce(jl.credit,0))
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_fix_id);
  end loop;
end $$;

notify pgrst, 'reload schema';

