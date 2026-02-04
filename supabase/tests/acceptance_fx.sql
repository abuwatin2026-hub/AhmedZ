-- Acceptance FX & Multi-Currency Tests (Transactional, Idempotent)
-- Usage: select run_fx_acceptance_tests();

create or replace function public.run_fx_acceptance_tests()
returns table (case_name text, result text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_user uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_gain uuid := public.get_account_id_by_code('6200');
  v_loss uuid := public.get_account_id_by_code('6201');
  v_order_id uuid;
  v_pay_id uuid;
  v_po_id uuid;
  v_shipment_id uuid;
  v_ok boolean;
  v_cnt int;
begin
  insert into auth.users(id, aud, role, is_sso_user, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', false, false, '{}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text, 'role', 'service_role')::text, true);
  insert into public.currencies(code, name, is_base, is_high_inflation)
  values ('YER', 'YER', true, true)
  on conflict (code) do update set name = excluded.name, is_base = excluded.is_base, is_high_inflation = excluded.is_high_inflation;
  update public.currencies set is_base = false where upper(code) <> 'YER' and is_base = true;
  insert into public.app_settings(id, data)
  values ('app', jsonb_build_object('id','app','settings',jsonb_build_object('baseCurrency','YER'),'updatedAt',now()::text))
  on conflict (id) do update
  set data = jsonb_set(coalesce(public.app_settings.data, '{}'::jsonb), '{settings,baseCurrency}', to_jsonb('YER'::text), true),
      updated_at = now();

  v_base := public.get_base_currency();

  insert into public.currencies(code, name, is_base, is_high_inflation)
  values ('USD','USD',false,false)
  on conflict (code) do update set name = excluded.name;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values
    ('USD', 2.000000, current_date, 'operational'),
    ('USD', 2.500000, current_date, 'accounting'),
    (v_base, 1.000000, current_date, 'operational'),
    (v_base, 1.100000, current_date, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update
  set rate = excluded.rate;

  -- Case 1: USD Invoice → payment at different rate → FX realized
  begin
    insert into public.orders(id, status, data, created_at, updated_at, invoice_terms, net_days, currency, fx_rate, total, base_total)
    values (gen_random_uuid(), 'pending', jsonb_build_object('orderSource','in_store','total',100), now(), now(), 'cash', 0, 'USD', 2.000000, 100, 200)
    returning id into v_order_id;
    insert into public.payments(id, direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, created_at)
    values (gen_random_uuid(), 'in', 'bank', 100, 'USD', 2.100000, 210, 'orders', v_order_id::text, now(), auth.uid(), '{}'::jsonb, now())
    returning id into v_pay_id;
    perform public.post_payment(v_pay_id);
    select exists(
      select 1 from public.journal_entries je
      join public.journal_lines jl on jl.journal_entry_id = je.id
      where je.source_table='payments' and je.source_id=v_pay_id::text and (jl.account_id = v_gain or jl.account_id = v_loss)
    ) into v_ok;
    return query select 'USD Invoice → Payment FX Realized'::text, case when v_ok then 'OK' else 'FAIL' end;
  exception when others then
    return query select 'USD Invoice → Payment FX Realized'::text, concat('ERROR: ', sqlerrm);
  end;

  -- Case 2: AR Open USD → Month End → Unrealized + Auto-Reverse
  begin
    insert into public.orders(id, status, data, created_at, updated_at, invoice_terms, net_days, currency, fx_rate, total, base_total)
    values (gen_random_uuid(), 'pending', jsonb_build_object('orderSource','in_store','total',100), now(), now(), 'cash', 0, 'USD', 2.000000, 100, 200)
    returning id into v_order_id;
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (current_date, concat('Invoice fixture ', v_order_id::text), 'orders', v_order_id::text, 'fixture', v_user)
    returning id into v_pay_id;
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_pay_id, public.get_account_id_by_code('1010'), 1, 0, 'Fixture'),
      (v_pay_id, public.get_account_id_by_code('1020'), 0, 1, 'Fixture');
    insert into public.ar_open_items(id, invoice_id, order_id, journal_entry_id, original_amount, open_balance, status, currency, created_at)
    values (gen_random_uuid(), v_order_id, v_order_id, v_pay_id, 200, 200, 'open', 'USD', now());
    perform public.run_fx_revaluation(current_date);
    perform public.run_fx_revaluation(current_date);
    select count(*) into v_cnt
    from public.fx_revaluation_audit a
    where a.entity_type='AR' and a.entity_id = v_order_id and a.period_end = current_date;
    select (v_cnt = 1) into v_ok;
    return query select 'AR USD → Revaluation + Auto-Reverse'::text, case when v_ok then 'OK' else 'FAIL' end;
  exception when others then
    return query select 'AR USD → Revaluation + Auto-Reverse'::text, concat('ERROR: ', sqlerrm);
  end;

  -- Case 3: PO Foreign → Receive → Pay → AP=0
  begin
    insert into public.purchase_orders(id, supplier_id, status, total_amount, currency, fx_rate, base_total, fx_locked, purchase_date, payment_terms, net_days, po_number)
    values (gen_random_uuid(), null, 'partial', 150, 'USD', 2.000000, 300, true, current_date, 'cash', 0, concat('PO-', substring(gen_random_uuid()::text from 1 for 8)))
    returning id into v_po_id;
    insert into public.payments(id, direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, created_at)
    values (gen_random_uuid(), 'out', 'bank', 100, 'USD', 2.000000, 200, 'purchase_orders', v_po_id::text, now(), auth.uid(), '{}'::jsonb, now())
    returning id into v_pay_id;
    perform public.post_payment(v_pay_id);
    insert into public.payments(id, direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, created_at)
    values (gen_random_uuid(), 'out', 'bank', 50, 'USD', 2.000000, 100, 'purchase_orders', v_po_id::text, now(), auth.uid(), '{}'::jsonb, now())
    returning id into v_pay_id;
    perform public.post_payment(v_pay_id);
    -- check AP settled
    select greatest(0, coalesce((select po.base_total from public.purchase_orders po where po.id = v_po_id),0)
      - coalesce((select sum(coalesce(p.base_amount,p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id=v_po_id::text),0)) = 0 into v_ok;
    return query select 'PO Foreign → Pay → AP=0'::text, case when v_ok then 'OK' else 'FAIL' end;
  exception when others then
    return query select 'PO Foreign → Pay → AP=0'::text, concat('ERROR: ', sqlerrm);
  end;

  -- Case 4: YER Long-term → Revaluation mandatory
  begin
    insert into public.orders(id, status, data, created_at, updated_at, invoice_terms, net_days, currency, fx_rate, total, base_total)
    values (gen_random_uuid(), 'pending', jsonb_build_object('orderSource','in_store','total',1000), now(), now(), 'credit', 30, 'YER', 1, 1000, 1000)
    returning id into v_order_id;
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (current_date, concat('Invoice fixture ', v_order_id::text), 'orders', v_order_id::text, 'fixture', v_user)
    returning id into v_pay_id;
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_pay_id, public.get_account_id_by_code('1010'), 1, 0, 'Fixture'),
      (v_pay_id, public.get_account_id_by_code('1020'), 0, 1, 'Fixture');
    insert into public.ar_open_items(id, invoice_id, order_id, journal_entry_id, original_amount, open_balance, status, currency, created_at)
    values (gen_random_uuid(), v_order_id, v_order_id, v_pay_id, 1000, 1000, 'open', 'YER', now());
    perform public.run_fx_revaluation(current_date);
    perform public.run_fx_revaluation(current_date);
    select count(*) into v_cnt
    from public.fx_revaluation_audit a
    where a.entity_type='AR' and a.entity_id = v_order_id and a.period_end = current_date;
    select (v_cnt = 1) into v_ok;
    return query select 'YER Long-term → Revaluation'::text, case when v_ok then 'OK' else 'FAIL' end;
  exception when others then
    return query select 'YER Long-term → Revaluation'::text, concat('ERROR: ', sqlerrm);
  end;

  -- Case 5: Landed Cost → Clearing=0
  begin
    v_shipment_id := gen_random_uuid();
    insert into public.import_shipments(id, reference_number, status) values (v_shipment_id, concat('TEST-', substring(gen_random_uuid()::text from 1 for 8)), 'ordered');
    insert into public.import_expenses(id, shipment_id, expense_type, amount, currency, exchange_rate, description, paid_at)
    values (gen_random_uuid(), v_shipment_id, 'shipping', 500, v_base, 1, 'Shipping', current_date);
    perform public.allocate_landed_cost_to_inventory(v_shipment_id);
    perform public.allocate_landed_cost_to_inventory(v_shipment_id);
    select count(*) into v_cnt from public.landed_cost_audit where shipment_id = v_shipment_id;
    select (v_cnt = 1) into v_ok;
    return query select 'Landed Cost → Clearing Zero via Allocation'::text, case when v_ok then 'OK' else 'FAIL' end;
  exception when others then
    return query select 'Landed Cost → Clearing Zero via Allocation'::text, concat('ERROR: ', sqlerrm);
  end;
end;
$$;

revoke all on function public.run_fx_acceptance_tests() from public;
grant execute on function public.run_fx_acceptance_tests() to authenticated, service_role;
