do $$
declare
  t0 timestamptz;
  ms int;
  v_owner uuid;
  v_exists int;
begin
  t0 := clock_timestamp();
  if to_regclass('public.chart_of_accounts') is null then raise exception 'missing chart_of_accounts'; end if;
  if to_regclass('public.journal_entries') is null then raise exception 'missing journal_entries'; end if;
  if to_regclass('public.journal_lines') is null then raise exception 'missing journal_lines'; end if;
  if to_regclass('public.orders') is null then raise exception 'missing orders'; end if;
  if to_regclass('public.payments') is null then raise exception 'missing payments'; end if;
  if to_regclass('public.inventory_movements') is null then raise exception 'missing inventory_movements'; end if;
  if to_regclass('public.purchase_orders') is null then raise exception 'missing purchase_orders'; end if;
  if to_regclass('public.purchase_items') is null then raise exception 'missing purchase_items'; end if;
  if to_regclass('public.expenses') is null then raise exception 'missing expenses'; end if;
  if to_regclass('public.payroll_runs') is null then raise exception 'missing payroll_runs'; end if;
  if to_regclass('public.bank_accounts') is null then raise exception 'missing bank_accounts'; end if;
  if to_regclass('public.bank_statement_batches') is null then raise exception 'missing bank_statement_batches'; end if;
  if to_regclass('public.accounting_documents') is null then raise exception 'missing accounting_documents'; end if;
  if to_regclass('public.accounting_periods') is null then raise exception 'missing accounting_periods'; end if;
  if to_regprocedure('public.reverse_journal_entry(uuid,text)') is null then raise exception 'missing reverse_journal_entry'; end if;
  if to_regprocedure('public.close_accounting_period(uuid)') is null then raise exception 'missing close_accounting_period'; end if;
  if to_regprocedure('public.run_fx_revaluation(date)') is null then raise exception 'missing run_fx_revaluation'; end if;

  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then raise exception 'missing local owner auth.users row for owner@azta.com'; end if;
  perform set_config('app.smoke_owner_id', v_owner::text, false);

  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|INIT01|Prerequisites and owner session|%|{}', ms;
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_wh uuid;
begin
  t0 := clock_timestamp();
  select public._resolve_default_admin_warehouse_id() into v_wh;
  if v_wh is null then
    insert into public.warehouses(code, name, type, is_active)
    values ('MAIN', 'Main Warehouse', 'main', true)
    on conflict (code) do update set is_active = excluded.is_active;
    select public._resolve_default_admin_warehouse_id() into v_wh;
  end if;
  if v_wh is null then raise exception 'warehouse_id is required'; end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|INIT02|Default warehouse available|%|{"warehouse_id":"%"}', ms, v_wh::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_cash uuid;
  v_sales uuid;
  v_sum numeric;
begin
  t0 := clock_timestamp();
  v_cash := public.get_account_id_by_code('1010');
  v_sales := public.get_account_id_by_code('4010');
  if v_cash is null or v_sales is null then raise exception 'missing required accounts'; end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (now(), 'smoke manual balanced', 'manual', gen_random_uuid()::text, 'smoke', auth.uid())
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry, v_cash, 100, 0, 'debit'), (v_entry, v_sales, 0, 100, 'credit');

  perform public.check_journal_entry_balance(v_entry);

  select abs(coalesce(sum(jl.debit),0) - coalesce(sum(jl.credit),0))
  into v_sum
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry;
  if v_sum > 1e-6 then raise exception 'manual journal entry not balanced'; end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL01|Manual balanced journal entry|%|{"entry_id":"%"}', ms, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_cash uuid;
  v_sales uuid;
  v_failed boolean := false;
begin
  t0 := clock_timestamp();
  v_cash := public.get_account_id_by_code('1010');
  v_sales := public.get_account_id_by_code('4010');
  begin
    v_entry := gen_random_uuid();
    insert into public.journal_entries(id, entry_date, memo, source_table, source_id, source_event, created_by)
    values (v_entry, now(), 'smoke manual unbalanced', 'manual', gen_random_uuid()::text, 'smoke', auth.uid());
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry, v_cash, 100, 0, 'debit'), (v_entry, v_sales, 0, 90, 'credit');
    perform public.check_journal_entry_balance(v_entry);
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if v_failed is not true then
    raise exception 'expected unbalanced journal entry to fail';
  end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL02|Unbalanced journal entry rejected|%|{"entry_id":"%"}', ms, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_cash uuid;
  v_failed boolean := false;
begin
  t0 := clock_timestamp();
  v_cash := public.get_account_id_by_code('1010');
  begin
    v_entry := gen_random_uuid();
    insert into public.journal_entries(id, entry_date, memo, source_table, source_id, source_event, created_by)
    values (v_entry, now(), 'smoke both sides line', 'manual', gen_random_uuid()::text, 'smoke', auth.uid());
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry, v_cash, 1, 1, 'invalid');
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if v_failed is not true then
    raise exception 'expected debit+credit line to be rejected';
  end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL03|Journal line debit+credit rejected|%|{"entry_id":"%"}', ms, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_doc uuid;
  v_status text;
  v_num text;
begin
  t0 := clock_timestamp();
  insert into public.accounting_documents(document_type, source_table, source_id, branch_id, company_id, status, memo, created_by)
  values ('manual', 'manual', gen_random_uuid()::text, public.get_default_branch_id(), public.get_default_company_id(), 'draft', 'smoke doc', auth.uid())
  returning id into v_doc;

  perform public.approve_accounting_document(v_doc);
  select status into v_status from public.accounting_documents where id = v_doc;
  if v_status <> 'approved' then raise exception 'document not approved'; end if;

  v_num := public.ensure_accounting_document_number(v_doc);
  if v_num is null or length(btrim(v_num)) = 0 then raise exception 'document number missing'; end if;

  perform public.mark_accounting_document_printed(v_doc, 'Smoke');

  begin
    update public.accounting_documents set memo = memo || 'x' where id = v_doc;
    raise exception 'expected approved accounting_documents update to fail';
  exception when others then
    null;
  end;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|DOC01|Document engine numbering/approval/immutability|%|{"document_id":"%","number":"%"}', ms, v_doc::text, v_num;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_period_id uuid;
  v_start date;
  v_end date;
  v_closed boolean := false;
begin
  t0 := clock_timestamp();
  v_start := (current_date + (10000 + floor(random() * 100000))::int);
  v_end := v_start + 30;

  insert into public.accounting_periods(name, start_date, end_date, status)
  values (concat('SMOKE-', v_start::text), v_start, v_end, 'open')
  returning id into v_period_id;

  begin
    perform public.close_accounting_period(v_period_id);
  exception when others then
    raise exception 'SMOKE_FAIL|GL04|Period closing and closed-period enforcement|%|SQLSTATE=%', sqlerrm, sqlstate;
  end;
  if not exists (select 1 from public.accounting_periods ap where ap.id = v_period_id and ap.status = 'closed') then
    raise exception 'period not closed';
  end if;

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (v_start::timestamptz + interval '1 day', 'smoke closed period insert', 'manual', gen_random_uuid()::text, 'smoke', auth.uid());
    v_closed := false;
  exception when others then
    v_closed := true;
  end;
  if v_closed is not true then
    raise exception 'expected journal insert in closed period to fail';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL04|Period closing and closed-period enforcement|%|{"period_id":"%"}', ms, v_period_id::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_rev uuid;
begin
  t0 := clock_timestamp();

  select je.id
  into v_entry
  from public.journal_entries je
  where coalesce(je.source_table,'') = 'manual'
  order by je.created_at desc
  limit 1;
  if v_entry is null then raise exception 'missing manual journal entry for reversal'; end if;

  select public.reverse_journal_entry(v_entry, 'smoke reversal') into v_rev;
  if v_rev is null then raise exception 'reverse_journal_entry returned null'; end if;

  if not exists (
    select 1
    from public.journal_entries je
    where je.id = v_rev
      and je.source_table = 'journal_entries'
      and je.source_id = v_entry::text
      and je.source_event = 'reversal'
  ) then
    raise exception 'reversal journal entry not linked';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL05|Reverse journal entry|%|{"entry_id":"%","reversal_id":"%"}', ms, v_entry::text, v_rev::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_line uuid;
  v_failed_update boolean := false;
  v_failed_delete boolean := false;
begin
  t0 := clock_timestamp();

  select je.id
  into v_entry
  from public.journal_entries je
  where coalesce(je.source_table,'') <> 'manual'
  order by je.created_at desc
  limit 1;
  if v_entry is null then raise exception 'missing system journal entry for immutability test'; end if;

  select jl.id into v_line from public.journal_lines jl where jl.journal_entry_id = v_entry limit 1;
  if v_line is null then raise exception 'missing system journal lines'; end if;

  begin
    update public.journal_lines set line_memo = coalesce(line_memo,'') || 'x' where id = v_line;
    v_failed_update := false;
  exception when others then
    v_failed_update := true;
  end;
  if v_failed_update is not true then
    raise exception 'expected posted journal line update to fail';
  end if;

  begin
    delete from public.journal_entries where id = v_entry;
    v_failed_delete := false;
  exception when others then
    v_failed_delete := true;
  end;
  if v_failed_delete is not true then
    raise exception 'expected posted journal entry delete to fail';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|GL06|Immutability of posted journal entries/lines|%|{"entry_id":"%"}', ms, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_base text;
  v_usd text := 'USD';
  v_order_id uuid;
  v_payment_id uuid;
  v_exists int;
begin
  t0 := clock_timestamp();
  v_base := public.get_base_currency();

  insert into public.currencies(code, name, is_base)
  values (v_base, v_base, true)
  on conflict (code) do update set is_base = excluded.is_base;
  insert into public.currencies(code, name, is_base)
  values (v_usd, 'US Dollar', false)
  on conflict (code) do nothing;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, 2.00, current_date, 'operational')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  v_order_id := gen_random_uuid();
  insert into public.orders(id, status, data, updated_at, currency, fx_rate, base_total, fx_locked, total)
  values (
    v_order_id,
    'delivered',
    jsonb_build_object('total', 10, 'subtotal', 10, 'taxAmount', 0, 'deliveryFee', 0, 'discountAmount', 0, 'orderSource', 'in_store', 'paymentMethod', 'cash', 'currency', v_usd, 'fxRate', 2.00),
    now(),
    v_usd,
    2.00,
    20,
    true,
    10
  );

  perform public.post_order_delivery(v_order_id);

  v_payment_id := gen_random_uuid();
  insert into public.payments(id, direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, fx_locked)
  values (v_payment_id, 'in', 'bank', 10, v_usd, 2.20, 22, 'orders', v_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', v_order_id::text), true);
  perform public.post_payment(v_payment_id);

  select count(1) into v_exists
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.source_table='payments' and je.source_id=v_payment_id::text and coa.code in ('6200','6201');
  if v_exists < 1 then
    raise exception 'missing realized FX lines for payment';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|FX01|Multi-currency order+payment realized FX|%|{"order_id":"%","payment_id":"%"}', ms, v_order_id::text, v_payment_id::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_usd text := 'USD';
  v_period date := (current_date + interval '10 day')::date;
  v_exists int;
begin
  t0 := clock_timestamp();
  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, 2.30, v_period, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  perform public.run_fx_revaluation(v_period);

  select count(1) into v_exists from public.fx_revaluation_monetary_audit a where a.period_end = v_period;
  if v_exists < 1 then raise exception 'missing fx_revaluation_monetary_audit rows'; end if;

  if not exists (
    select 1
    from public.fx_revaluation_monetary_audit a
    where a.period_end = v_period
      and a.reversal_journal_entry_id is not null
  ) then
    raise exception 'missing auto-reversal for revaluation';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|FX02|Unrealized FX revaluation + auto-reversal|%|{"period_end":"%","audit_rows":%}', ms, v_period::text, v_exists;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_base text;
  v_yer text := 'YER';
  v_base_high boolean := false;
  v_saved numeric;
begin
  t0 := clock_timestamp();
  v_base := public.get_base_currency();
  select coalesce(c.is_high_inflation,false) into v_base_high from public.currencies c where upper(c.code)=upper(v_base) limit 1;

  if not v_base_high then
    insert into public.currencies(code, name, is_base, is_high_inflation)
    values (v_yer, 'Yemeni Rial', false, true)
    on conflict (code) do update set is_high_inflation = excluded.is_high_inflation;
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values (v_yer, 400, current_date, 'operational')
    on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;
    select fr.rate into v_saved from public.fx_rates fr where fr.currency_code = v_yer and fr.rate_date = current_date and fr.rate_type='operational' limit 1;
    if v_saved is null or v_saved >= 1 then
      raise exception 'expected normalized high inflation rate < 1, got %', v_saved;
    end if;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|FX03|High-inflation FX normalization|%|{"base":"%","base_is_high":%}', ms, v_base, case when v_base_high then 'true' else 'false' end;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_wh uuid;
  v_supplier uuid;
  v_po uuid;
  v_item text;
  v_receipt uuid;
  v_paid_ok boolean := false;
  v_pay_err text;
  v_pay_state text;
begin
  t0 := clock_timestamp();
  select public._resolve_default_admin_warehouse_id() into v_wh;
  if v_wh is null then raise exception 'warehouse_id missing'; end if;

  v_item := 'SMOKE-PO-' || replace(gen_random_uuid()::text,'-','');
  begin
    insert into public.menu_items(id, category, unit_type, base_unit, status, name, price, is_food, expiry_required, sellable, data)
    values (
      v_item,
      'qat',
      'piece',
      'piece',
      'active',
      jsonb_build_object('ar','صنف مشتريات دخان','en','PO Smoke Item'),
      100,
      false,
      false,
      true,
      jsonb_build_object('id', v_item, 'name', jsonb_build_object('ar','صنف مشتريات دخان'), 'price', 100, 'category', 'qat', 'unitType', 'piece', 'status', 'active')
    );
  exception when undefined_column then
    insert into public.menu_items(id, category, unit_type, status, data)
    values (v_item, 'qat', 'piece', 'active', jsonb_build_object('id', v_item, 'name', jsonb_build_object('ar','صنف مشتريات دخان'), 'price', 100));
  end;

  if to_regclass('public.item_uom') is not null then
    insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
    values (v_item, public.get_or_create_uom('piece'), null, null)
    on conflict (item_id) do nothing;
  end if;

  insert into public.suppliers(name) values ('Smoke Supplier') returning id into v_supplier;

  insert into public.purchase_orders(supplier_id, status, total_amount, paid_amount, purchase_date, items_count, notes, created_by, currency, fx_rate)
  values (v_supplier, 'draft', 50, 0, current_date, 1, 'smoke', auth.uid(), public.get_base_currency(), 1)
  returning id into v_po;

  insert into public.purchase_items(purchase_order_id, item_id, quantity, unit_cost, total_cost)
  values (v_po, v_item, 10, 5, 50);

  select public.receive_purchase_order_partial(v_po, jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 10, 'unitCost', 5)), now())
  into v_receipt;

  begin
    perform public.record_purchase_order_payment(
      v_po,
      20::numeric,
      'bank'::text,
      now()::timestamptz,
      jsonb_build_object('idempotencyKey', concat('smoke:', v_po::text, ':1'))::jsonb,
      public.get_base_currency()::text
    );
    v_paid_ok := true;
  exception when others then
    v_paid_ok := false;
    v_pay_err := sqlerrm;
    v_pay_state := sqlstate;
  end;
  if v_paid_ok is not true then
    raise exception 'SMOKE_FAIL|PO01|Purchase order receive+partial payment|%|SQLSTATE=%', v_pay_err, v_pay_state;
  end if;

  if not exists (select 1 from public.inventory_movements im where im.reference_table in ('purchase_receipts','purchase_orders') and im.reference_id = v_receipt::text and im.movement_type = 'purchase_in') then
    raise exception 'missing purchase_in movement';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PO01|Purchase order receive+partial payment|%|{"po_id":"%","receipt_id":"%","item_id":"%"}', ms, v_po::text, v_receipt::text, v_item;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_po uuid;
  v_item text;
  v_ret uuid;
begin
  t0 := clock_timestamp();
  select po.id into v_po from public.purchase_orders po order by po.created_at desc limit 1;
  select pi.item_id into v_item from public.purchase_items pi where pi.purchase_order_id = v_po limit 1;
  if v_po is null or v_item is null then raise exception 'missing purchase order context'; end if;

  select public.create_purchase_return(v_po, jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 1)), 'smoke', now()) into v_ret;
  if v_ret is null then raise exception 'create_purchase_return returned null'; end if;

  if not exists (select 1 from public.inventory_movements im where im.reference_table = 'purchase_returns' and im.reference_id = v_ret::text) then
    raise exception 'missing inventory movement for purchase return';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PO02|Purchase return|%|{"purchase_return_id":"%"}', ms, v_ret::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_wh uuid;
  v_item text;
  v_order uuid;
  v_payload jsonb;
  v_items jsonb;
  v_updated jsonb;
  v_payment_count int;
begin
  t0 := clock_timestamp();
  select public._resolve_default_admin_warehouse_id() into v_wh;
  select pi.item_id into v_item from public.purchase_items pi order by pi.created_at desc limit 1;
  if v_item is null then raise exception 'missing item for sales'; end if;

  v_order := gen_random_uuid();
  v_items := jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2));
  v_updated := jsonb_build_object(
    'id', v_order::text,
    'status', 'delivered',
    'orderSource', 'in_store',
    'deliveredAt', now()::text,
    'paidAt', now()::text,
    'paymentMethod', 'bank',
    'items', v_items,
    'subtotal', 200,
    'deliveryFee', 0,
    'discountAmount', 0,
    'taxAmount', 0,
    'total', 200,
    'currency', public.get_base_currency()
  );

  insert into public.orders(id, status, data, updated_at)
  values (v_order, 'pending', v_updated, now());

  v_payload := jsonb_build_object('p_order_id', v_order::text, 'p_items', v_items, 'p_updated_data', v_updated, 'p_warehouse_id', v_wh::text);
  perform public.confirm_order_delivery(v_payload);

  perform public.record_order_payment_v2(v_order, 50, 'bank', now(), concat('smoke-pay:', v_order::text, ':1'), public.get_base_currency(), '{}'::jsonb);
  perform public.record_order_payment_v2(v_order, 150, 'bank', now(), concat('smoke-pay:', v_order::text, ':2'), public.get_base_currency(), '{}'::jsonb);

  select count(1) into v_payment_count
  from public.payments p
  where p.reference_table = 'orders' and p.reference_id = v_order::text and p.direction='in';
  if v_payment_count < 2 then raise exception 'missing order payments'; end if;

  if not exists (select 1 from public.inventory_movements im where im.reference_table='orders' and im.reference_id=v_order::text and im.movement_type='sale_out') then
    raise exception 'missing sale_out movements';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SALES01|Sales delivery + partial/full payments + COGS movements|%|{"order_id":"%","payments":%}', ms, v_order::text, v_payment_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_order uuid;
  v_item text;
  v_ret uuid;
begin
  t0 := clock_timestamp();
  select o.id into v_order from public.orders o where o.status='delivered' order by o.updated_at desc limit 1;
  select (o.data->'items'->0->>'itemId')::text into v_item from public.orders o where o.id = v_order;
  if v_order is null or v_item is null then raise exception 'missing delivered order for return'; end if;

  insert into public.sales_returns(order_id, return_date, reason, refund_method, total_refund_amount, items, status, created_by)
  values (v_order, now(), 'smoke', 'kuraimi', 50, jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 1)), 'draft', auth.uid())
  returning id into v_ret;

  perform public.process_sales_return(v_ret);

  if not exists (select 1 from public.sales_returns r where r.id = v_ret and r.status='completed') then
    raise exception 'sales return not completed';
  end if;

  if not exists (select 1 from public.inventory_movements im where im.reference_table='sales_returns' and im.reference_id=v_ret::text and im.movement_type='return_in') then
    raise exception 'missing return_in movement';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SALES02|Sales return flow|%|{"sales_return_id":"%"}', ms, v_ret::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_line uuid;
  v_failed boolean := false;
begin
  t0 := clock_timestamp();
  select je.id into v_entry from public.journal_entries je where je.source_table='inventory_movements' order by je.created_at desc limit 1;
  if v_entry is null then raise exception 'missing inventory_movements journal entry'; end if;
  select jl.id into v_line from public.journal_lines jl where jl.journal_entry_id = v_entry limit 1;
  if v_line is null then raise exception 'missing inventory movement lines'; end if;
  begin
    update public.journal_lines set line_memo = coalesce(line_memo,'') || 'x' where id = v_line;
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if v_failed is not true then
    raise exception 'expected system journal line update to fail';
  end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|INV01|Inventory posted journal immutability|%|{"entry_id":"%"}', ms, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_mv uuid;
  v_failed_update boolean := false;
  v_failed_delete boolean := false;
begin
  t0 := clock_timestamp();
  select im.id into v_mv
  from public.inventory_movements im
  join public.journal_entries je on je.source_table='inventory_movements' and je.source_id=im.id::text
  order by im.created_at desc
  limit 1;
  if v_mv is null then raise exception 'missing posted inventory movement'; end if;

  begin
    update public.inventory_movements set data = jsonb_set(coalesce(data,'{}'::jsonb), '{smoke}', 'true'::jsonb, true) where id = v_mv;
    v_failed_update := false;
  exception when others then
    v_failed_update := true;
  end;
  if v_failed_update is not true then
    raise exception 'expected inventory movement update to fail';
  end if;

  begin
    delete from public.inventory_movements where id = v_mv;
    v_failed_delete := false;
  exception when others then
    v_failed_delete := true;
  end;
  if v_failed_delete is not true then
    raise exception 'expected inventory movement delete to fail';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|INV02|Inventory movement append-only after posting|%|{"movement_id":"%"}', ms, v_mv::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_exp uuid;
  v_entry uuid;
  v_fail_delete boolean := false;
  v_override uuid;
begin
  t0 := clock_timestamp();
  begin
    insert into public.expenses(title, amount, category, date, notes, created_by, data)
    values ('smoke accrual expense', 10, 'other', current_date, null, auth.uid(), '{}'::jsonb)
    returning id into v_exp;
  exception when undefined_column then
    insert into public.expenses(title, amount, category, date, notes, created_by)
    values ('smoke accrual expense', 10, 'other', current_date, null, auth.uid())
    returning id into v_exp;
  end;

  v_override := public.get_account_id_by_code('2050');
  begin
    update public.expenses
    set data = jsonb_set(coalesce(data,'{}'::jsonb), '{overrideAccountId}', to_jsonb(v_override::text), true)
    where id = v_exp;
  exception when undefined_column then
    null;
  end;

  perform public.record_expense_accrual(v_exp, 10, now());

  select je.id into v_entry from public.journal_entries je where je.source_table='expenses' and je.source_id=v_exp::text order by je.created_at desc limit 1;
  if v_entry is null then raise exception 'missing expense accrual journal'; end if;

  perform public.record_expense_payment(v_exp, 10, 'bank', now());

  begin
    delete from public.expenses where id = v_exp;
    v_fail_delete := false;
  exception when others then
    v_fail_delete := true;
  end;
  if v_fail_delete is not true then
    raise exception 'expected posted expense delete to fail';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|EXP01|Expense accrual + override + payment + delete guard|%|{"expense_id":"%"}', ms, v_exp::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_period text;
  v_emp uuid;
  v_run uuid;
  v_entry uuid;
begin
  t0 := clock_timestamp();
  loop
    v_period := concat((2100 + floor(random() * 1000))::int, '-', lpad(((1 + floor(random()*12))::int)::text, 2, '0'));
    exit when not exists (select 1 from public.payroll_runs pr where pr.period_ym = v_period);
  end loop;
  insert into public.payroll_employees(full_name, employee_code, monthly_salary, currency, is_active)
  values ('Smoke Payroll Employee', concat('SMK-FULL-', substr(md5(random()::text), 1, 8)), 100, public.get_base_currency(), true)
  returning id into v_emp;

  select public.create_payroll_run(v_period, 'smoke full') into v_run;
  if v_run is null then raise exception 'create_payroll_run returned null'; end if;

  update public.payroll_run_lines set gross = 100 where run_id = v_run and employee_id = v_emp;
  if not found then
    insert into public.payroll_run_lines(run_id, employee_id, gross) values (v_run, v_emp, 100);
  end if;

  perform public.compute_payroll_run_v3(v_run);
  select public.record_payroll_run_accrual_v2(v_run, now()) into v_entry;
  if v_entry is null then raise exception 'payroll accrual entry null'; end if;

  if not exists (select 1 from public.journal_lines jl where jl.journal_entry_id = v_entry) then
    raise exception 'missing payroll accrual lines';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PAY01|Payroll run compute + accrual posting|%|{"run_id":"%","entry_id":"%"}', ms, v_run::text, v_entry::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_bank uuid;
  v_batch uuid;
  v_line uuid;
  v_payment uuid;
  v_match uuid;
begin
  t0 := clock_timestamp();
  insert into public.bank_accounts(name, bank_name, account_number, currency, is_active)
  values ('Smoke Bank Full', 'SmokeBank', '999', public.get_base_currency(), true)
  returning id into v_bank;

  select public.import_bank_statement(v_bank, current_date - 7, current_date,
    jsonb_build_array(
      jsonb_build_object('date', (current_date - 1)::text, 'amount', 1500, 'currency', public.get_base_currency(), 'description', 'smoke', 'externalId', concat('SMK-EXT-FULL-', substr(md5(random()::text),1,8)))
    )
  ) into v_batch;
  if v_batch is null then raise exception 'import_bank_statement returned null'; end if;

  select id into v_line from public.bank_statement_lines where batch_id = v_batch limit 1;
  if v_line is null then raise exception 'missing statement line'; end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
  values ('out', 'kuraimi', 1500, public.get_base_currency(), 'expenses', gen_random_uuid()::text, now(), auth.uid(), '{}'::jsonb)
  returning id into v_payment;

  insert into public.bank_reconciliation_matches(statement_line_id, payment_id, matched_by, status)
  values (v_line, v_payment, auth.uid(), 'matched')
  returning id into v_match;
  if v_match is null then raise exception 'manual match insert failed'; end if;

  update public.bank_statement_lines set matched = true where id = v_line;

  perform public.reconcile_bank_batch(v_batch, 3, 0.01);
  perform public.close_bank_statement_batch(v_batch);

  if not exists (select 1 from public.bank_statement_batches b where b.id = v_batch and b.status = 'closed') then
    raise exception 'batch not closed';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|BANK01|Bank reconciliation import/match/close|%|{"batch_id":"%"}', ms, v_batch::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_order uuid;
  v_pay uuid;
  v_fail_order boolean := false;
  v_fail_payment boolean := false;
begin
  t0 := clock_timestamp();

  select o.id into v_order from public.orders o where o.status='delivered' order by o.updated_at desc limit 1;
  if v_order is null then raise exception 'missing delivered order for immutability'; end if;

  begin
    update public.orders set base_total = base_total + 1 where id = v_order;
    v_fail_order := false;
  exception when others then
    v_fail_order := true;
  end;
  if v_fail_order is not true then
    raise exception 'expected orders.base_total update after posting to fail';
  end if;

  select p.id into v_pay from public.payments p where p.reference_table='orders' and p.reference_id=v_order::text order by p.created_at desc limit 1;
  if v_pay is null then raise exception 'missing payment for immutability'; end if;

  begin
    update public.payments set base_amount = base_amount + 1 where id = v_pay;
    v_fail_payment := false;
  exception when others then
    v_fail_payment := true;
  end;
  if v_fail_payment is not true then
    raise exception 'expected payments.base_amount update after posting to fail';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|IMM01|Immutability: orders.base_total and payments.base_amount|%|{"order_id":"%","payment_id":"%"}', ms, v_order::text, v_pay::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_order uuid;
  v_pay uuid;
  v_mv uuid;
  v_exists boolean;
begin
  t0 := clock_timestamp();
  select o.id into v_order from public.orders o where o.status='delivered' order by o.updated_at desc limit 1;
  select p.id into v_pay from public.payments p where p.reference_table='orders' and p.reference_id=v_order::text order by p.created_at desc limit 1;
  select im.id into v_mv from public.inventory_movements im join public.journal_entries je on je.source_table='inventory_movements' and je.source_id=im.id::text order by im.created_at desc limit 1;
  if v_order is null or v_pay is null or v_mv is null then
    raise exception 'missing entities for delete guard test';
  end if;

  begin
    delete from public.orders where id = v_order;
  exception when others then
    null;
  end;
  select exists(select 1 from public.orders o where o.id = v_order) into v_exists;
  if v_exists is not true then raise exception 'posted order was deleted'; end if;

  begin
    delete from public.payments where id = v_pay;
  exception when others then
    null;
  end;
  select exists(select 1 from public.payments p where p.id = v_pay) into v_exists;
  if v_exists is not true then raise exception 'posted payment was deleted'; end if;

  begin
    delete from public.inventory_movements where id = v_mv;
  exception when others then
    null;
  end;
  select exists(select 1 from public.inventory_movements im where im.id = v_mv) into v_exists;
  if v_exists is not true then raise exception 'posted inventory movement was deleted'; end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|IMM02|Delete guards: orders/payments/inventory|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_other uuid := gen_random_uuid();
  v_cnt int;
  v_failed_insert boolean := false;
  v_failed_fx boolean := false;
  v_owner_id text;
begin
  t0 := clock_timestamp();

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set role authenticated;

  select count(1) into v_cnt from public.payments;
  if v_cnt <> 0 then
    raise exception 'RLS violation: unauthorized user can read payments (count=%)', v_cnt;
  end if;

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (now(), 'unauthorized', 'manual', gen_random_uuid()::text, 'smoke', auth.uid());
    v_failed_insert := false;
  exception when others then
    v_failed_insert := true;
  end;
  if v_failed_insert is not true then
    raise exception 'RLS violation: unauthorized user inserted journal entry';
  end if;

  begin
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values ('USD', 123, current_date, 'operational');
    v_failed_fx := false;
  exception when others then
    v_failed_fx := true;
  end;
  if v_failed_fx is not true then
    raise exception 'RLS violation: unauthorized user inserted fx_rates';
  end if;

  v_owner_id := nullif(current_setting('app.smoke_owner_id', true), '');
  if v_owner_id is null then
    raise exception 'missing app.smoke_owner_id';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
  set role authenticated;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SEC01|RLS: payments read + journal/fx write blocked for unauthorized|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_cnt int;
begin
  t0 := clock_timestamp();

  select count(1) into v_cnt
  from public.system_audit_logs l
  where l.performed_by = auth.uid()
    and l.action in ('fx_revaluation.run','accounting_periods.close','journal_entries.reverse','app_settings.accounting_accounts.update');

  if v_cnt < 2 then
    raise exception 'expected at least 2 audit log entries for critical events, got %', v_cnt;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|AUD01|Audit logs coverage for critical events|%|{"rows":%}', ms, v_cnt;
end $$;

select 'FULL_SYSTEM_SMOKE_OK' as result;
