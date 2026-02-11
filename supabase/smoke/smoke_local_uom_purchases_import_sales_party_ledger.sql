\set ON_ERROR_STOP on

do $$
declare
  v_owner uuid;
  v_company uuid;
  v_branch uuid;
  v_wh uuid;
  v_base text;
  v_today date := current_date;
  v_rate_usd numeric := 3.75;
  v_rate_yer numeric := 0.015;

  v_supplier uuid;
  v_customer uuid := 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
  v_item text;
  v_carton uuid;
  v_pack uuid;

  v_shipment uuid;
  v_po_base uuid;
  v_po_yer uuid;
  v_receipt_base uuid;
  v_receipt_yer uuid;

  v_party_supplier uuid;
  v_party_customer uuid;
  v_cnt int;
  v_stock_available numeric;
  v_stock_avg numeric;

  v_order uuid;
  v_items jsonb;
  v_updated jsonb;
  v_payload jsonb;
  v_payment uuid;
begin
  select auth_user_id into v_owner
  from public.admin_users
  where role = 'owner' and is_active = true
  order by created_at asc
  limit 1;
  if v_owner is null then
    raise exception 'missing owner admin_users row';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_owner::text, false);

  select id into v_company from public.companies order by created_at asc limit 1;
  select id into v_branch from public.branches order by created_at asc limit 1;
  select public._resolve_default_warehouse_id() into v_wh;
  v_base := public.get_base_currency();
  if v_company is null or v_branch is null or v_wh is null then
    raise exception 'missing company/branch/warehouse seed';
  end if;

  insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
  values (v_customer,'authenticated','authenticated','local_customer@example.com',now(),now(),now())
  on conflict (id) do nothing;

  insert into public.customers(auth_user_id,email,full_name,phone_number,created_at)
  values (v_customer,'local_customer@example.com','عميل دخان محلي','700000000',now())
  on conflict (auth_user_id) do update set full_name=excluded.full_name;

  insert into public.currencies(code,name,is_base,is_high_inflation)
  values ('USD','US Dollar',false,false)
  on conflict (code) do update set is_high_inflation=false;
  insert into public.currencies(code,name,is_base,is_high_inflation)
  values ('YER','Yemeni Rial',false,true)
  on conflict (code) do update set is_high_inflation=true;

  insert into public.fx_rates(currency_code,rate,rate_date,rate_type)
  values ('USD',v_rate_usd,v_today,'operational')
  on conflict (currency_code,rate_date,rate_type) do update set rate=excluded.rate;
  insert into public.fx_rates(currency_code,rate,rate_date,rate_type)
  values ('USD',v_rate_usd,v_today,'accounting')
  on conflict (currency_code,rate_date,rate_type) do update set rate=excluded.rate;

  insert into public.fx_rates(currency_code,rate,rate_date,rate_type)
  values ('YER',v_rate_yer,v_today,'operational')
  on conflict (currency_code,rate_date,rate_type) do update set rate=excluded.rate;
  insert into public.fx_rates(currency_code,rate,rate_date,rate_type)
  values ('YER',v_rate_yer,v_today,'accounting')
  on conflict (currency_code,rate_date,rate_type) do update set rate=excluded.rate;

  raise notice 'SMOKE_PASS|FX00|Seed FX rates|0|{"base":"%","usd":%,"yer":%}', v_base, v_rate_usd, v_rate_yer;

  select id into v_supplier from public.suppliers where name='مورد دخان محلي' order by created_at desc limit 1;
  if v_supplier is null then
    insert into public.suppliers(name,contact_person,phone,email,address)
    values ('مورد دخان محلي','SMK','711111111','smk-supplier@example.com','صنعاء')
    returning id into v_supplier;
  end if;

  v_item := 'SMOKE-ITEM-' || replace(gen_random_uuid()::text,'-','');
  insert into public.menu_items(id,name,price,cost_price,is_food,expiry_required,data,base_unit,unit_type)
  values (
    v_item,
    jsonb_build_object('ar','صنف دخان متعدد الوحدات','en','Smoke Multi-UOM Item'),
    0,
    0,
    false,
    false,
    jsonb_build_object('group','SMOKE','createdFor','smoke_local_uom'),
    'piece',
    'piece'
  );

  insert into public.item_uom(item_id,base_uom_id,purchase_uom_id,sales_uom_id)
  values (v_item, public.ensure_uom_code('piece','Piece'), null, null)
  on conflict (item_id) do nothing;

  perform public.upsert_item_packaging_uom(v_item, 6, 24);

  select id into v_pack from public.uom where code='pack' limit 1;
  select id into v_carton from public.uom where code='carton' limit 1;
  if v_pack is null or v_carton is null then
    raise exception 'missing pack/carton uom';
  end if;

  insert into public.stock_management(item_id,warehouse_id,available_quantity,reserved_quantity,avg_cost,unit,last_updated,updated_at)
  values (v_item,v_wh,0,0,0,'piece',now(),now())
  on conflict (item_id,warehouse_id) do nothing;

  raise notice 'SMOKE_PASS|ITEM00|Created item + UOM units|0|{"item_id":"%","pack":"%","carton":"%"}', v_item, v_pack, v_carton;

  insert into public.import_shipments(reference_number,supplier_id,status,origin_country,destination_warehouse_id,shipping_carrier,tracking_number,departure_date,expected_arrival_date,notes,created_by)
  values ('SMK-SHIP-'||to_char(now(),'YYYYMMDD-HH24MISS'), v_supplier, 'draft', 'CN', v_wh, 'SMK', 'TRK-'||substring(gen_random_uuid()::text,1,8), current_date, current_date + 5, 'local smoke shipment', v_owner)
  returning id into v_shipment;

  insert into public.import_shipments_items(shipment_id,item_id,quantity,unit_price_fob,currency,notes)
  values (v_shipment, v_item, public.item_qty_to_base(v_item, 1, v_carton), 5, 'USD', 'carton FOB (demo)');

  insert into public.import_expenses(shipment_id,expense_type,amount,currency,exchange_rate,description,paid_at,created_by,payment_method)
  values (v_shipment,'shipping',1,'USD',v_rate_usd,'Sea freight',current_date,v_owner,'bank');

  insert into public.import_expenses(shipment_id,expense_type,amount,currency,exchange_rate,description,paid_at,created_by,payment_method)
  values (v_shipment,'customs',1,'YER',v_rate_yer,'Customs',current_date,v_owner,'bank');

  raise notice 'SMOKE_PASS|SHIP00|Created shipment + expenses|0|{"shipment_id":"%"}', v_shipment;

  insert into public.purchase_orders(supplier_id,status,reference_number,total_amount,paid_amount,purchase_date,items_count,notes,created_by,warehouse_id,branch_id,company_id,payment_terms,net_days,po_number,currency,fx_rate)
  values (v_supplier,'draft','SMK-PO-BASE-'||substring(gen_random_uuid()::text,1,8), 1, 0, current_date, 1, 'PO base carton', v_owner, v_wh, v_branch, v_company, 'cash', 0, 'SMKPO-BASE-'||substring(gen_random_uuid()::text,1,8), v_base, 1)
  returning id into v_po_base;

  insert into public.purchase_items(purchase_order_id,item_id,quantity,unit_cost,total_cost,uom_id)
  values (v_po_base, v_item, 1, 1, 1, v_carton);

  v_receipt_base := public.receive_purchase_order_partial(
    v_po_base,
    jsonb_build_array(jsonb_build_object('itemId',v_item,'quantity',1,'uomId',v_carton::text,'unitCost',1,'idempotencyKey','smk-receipt-base-1')),
    now()
  );

  raise notice 'SMOKE_PASS|PO00|PO+Receive Base (carton)|0|{"po":"%","receipt":"%"}', v_po_base, v_receipt_base;

  insert into public.purchase_orders(supplier_id,status,reference_number,total_amount,paid_amount,purchase_date,items_count,notes,created_by,warehouse_id,branch_id,company_id,payment_terms,net_days,po_number,currency,fx_rate)
  values (v_supplier,'draft','SMK-PO-YER-'||substring(gen_random_uuid()::text,1,8), 1, 0, current_date, 1, 'PO YER carton', v_owner, v_wh, v_branch, v_company, 'cash', 0, 'SMKPO-YER-'||substring(gen_random_uuid()::text,1,8), 'YER', v_rate_yer)
  returning id into v_po_yer;

  insert into public.purchase_items(purchase_order_id,item_id,quantity,unit_cost,total_cost,uom_id)
  values (v_po_yer, v_item, 1, 1, 1, v_carton);

  v_receipt_yer := public.receive_purchase_order_partial(
    v_po_yer,
    jsonb_build_array(jsonb_build_object('itemId',v_item,'quantity',1,'uomCode','carton','unitCost',1,'importShipmentId',v_shipment::text,'idempotencyKey','smk-receipt-yer-1')),
    now()
  );

  raise notice 'SMOKE_PASS|PO01|PO+Receive YER (carton)|0|{"po":"%","receipt":"%","shipment":"%"}', v_po_yer, v_receipt_yer, v_shipment;

  select available_quantity, avg_cost
  into v_stock_available, v_stock_avg
  from public.stock_management sm
  where sm.item_id::text = v_item and sm.warehouse_id = v_wh;

  raise notice 'SMOKE_PASS|STK00|Stock increased after receipts|0|{"available":%,"avg_cost":%}', coalesce(v_stock_available,0), coalesce(v_stock_avg,0);

  update public.import_shipments
  set status='delivered', actual_arrival_date=current_date, updated_at=now()
  where id=v_shipment;
  update public.import_shipments
  set status='closed', updated_at=now()
  where id=v_shipment;

  raise notice 'SMOKE_PASS|SHIP01|Close shipment + landed cost|0|{"shipment_id":"%"}', v_shipment;

  perform public.record_purchase_order_payment(v_po_base, 1, 'bank', now(), jsonb_build_object('idempotencyKey','smk-po-base-pay-1'), v_base);
  select id into v_payment
  from public.payments
  where reference_table='purchase_orders' and reference_id=v_po_base::text and data->>'idempotencyKey'='smk-po-base-pay-1'
  order by created_at desc
  limit 1;
  perform public.post_payment(v_payment);

  perform public.record_purchase_order_payment(v_po_yer, 1, 'bank', now(), jsonb_build_object('idempotencyKey','smk-po-yer-pay-1'), 'YER');
  select id into v_payment
  from public.payments
  where reference_table='purchase_orders' and reference_id=v_po_yer::text and data->>'idempotencyKey'='smk-po-yer-pay-1'
  order by created_at desc
  limit 1;
  perform public.post_payment(v_payment);

  raise notice 'SMOKE_PASS|PAY00|Supplier payments posted|0|{"po_base":"%","po_yer":"%"}', v_po_base, v_po_yer;

  update public.menu_items set price=15, updated_at=now() where id=v_item;

  v_order := gen_random_uuid();
  v_items := jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 3, 'uomCode', 'piece'));
  v_updated := jsonb_build_object('id', v_order::text,'status','delivered','orderSource','in_store','deliveredAt',now()::text,'paidAt',now()::text,'paymentMethod','bank','items',v_items,'subtotal',45,'deliveryFee',0,'discountAmount',0,'taxAmount',0,'total',45,'currency',v_base,'fxRate',1);
  insert into public.orders(id, customer_auth_user_id, status, data, updated_at, currency, fx_rate, base_total, total)
  values (v_order, v_customer, 'pending', v_updated, now(), v_base, 1, 45, 45);
  v_payload := jsonb_build_object('p_order_id', v_order::text, 'p_items', v_items, 'p_updated_data', v_updated, 'p_warehouse_id', v_wh::text);
  perform public.confirm_order_delivery(v_payload);
  insert into public.payments(id,direction,method,amount,currency,fx_rate,base_amount,reference_table,reference_id,occurred_at,created_by,data,fx_locked)
  values (gen_random_uuid(),'in','bank',45,v_base,1,45,'orders',v_order::text,now(),v_owner,jsonb_build_object('orderId',v_order::text,'idempotencyKey','smk-order-base-pay-1'),true)
  returning id into v_payment;
  perform public.post_payment(v_payment);

  v_order := gen_random_uuid();
  v_items := jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2, 'uomCode', 'pack'));
  v_updated := jsonb_build_object('id', v_order::text,'status','delivered','orderSource','in_store','deliveredAt',now()::text,'paidAt',now()::text,'paymentMethod','bank','items',v_items,'subtotal',10,'deliveryFee',0,'discountAmount',0,'taxAmount',0,'total',10,'currency','USD','fxRate',v_rate_usd);
  insert into public.orders(id, customer_auth_user_id, status, data, updated_at, currency, fx_rate, base_total, total)
  values (v_order, v_customer, 'pending', v_updated, now(), 'USD', v_rate_usd, (10*v_rate_usd), 10);
  v_payload := jsonb_build_object('p_order_id', v_order::text, 'p_items', v_items, 'p_updated_data', v_updated, 'p_warehouse_id', v_wh::text);
  perform public.confirm_order_delivery(v_payload);
  insert into public.payments(id,direction,method,amount,currency,fx_rate,base_amount,reference_table,reference_id,occurred_at,created_by,data,fx_locked)
  values (gen_random_uuid(),'in','bank',10,'USD',v_rate_usd,(10*v_rate_usd),'orders',v_order::text,now(),v_owner,jsonb_build_object('orderId',v_order::text,'idempotencyKey','smk-order-usd-pay-1'),true)
  returning id into v_payment;
  perform public.post_payment(v_payment);

  v_order := gen_random_uuid();
  v_items := jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 1, 'uomCode', 'carton'));
  v_updated := jsonb_build_object('id', v_order::text,'status','delivered','orderSource','in_store','deliveredAt',now()::text,'paidAt',now()::text,'paymentMethod','bank','items',v_items,'subtotal',1,'deliveryFee',0,'discountAmount',0,'taxAmount',0,'total',1,'currency','YER','fxRate',v_rate_yer);
  insert into public.orders(id, customer_auth_user_id, status, data, updated_at, currency, fx_rate, base_total, total)
  values (v_order, v_customer, 'pending', v_updated, now(), 'YER', v_rate_yer, (1*v_rate_yer), 1);
  v_payload := jsonb_build_object('p_order_id', v_order::text, 'p_items', v_items, 'p_updated_data', v_updated, 'p_warehouse_id', v_wh::text);
  perform public.confirm_order_delivery(v_payload);
  insert into public.payments(id,direction,method,amount,currency,fx_rate,base_amount,reference_table,reference_id,occurred_at,created_by,data,fx_locked)
  values (gen_random_uuid(),'in','bank',1,'YER',v_rate_yer,(1*v_rate_yer),'orders',v_order::text,now(),v_owner,jsonb_build_object('orderId',v_order::text,'idempotencyKey','smk-order-yer-pay-1'),true)
  returning id into v_payment;
  perform public.post_payment(v_payment);

  raise notice 'SMOKE_PASS|SALES00|Sold item in 3 units/currencies|0|{"item":"%"}', v_item;

  v_party_supplier := public.ensure_financial_party_for_supplier(v_supplier);
  v_party_customer := public.ensure_financial_party_for_customer(v_customer);

  select count(1) into v_cnt
  from public.journal_entries je
  where je.status='posted'
    and exists (
      select 1
      from public.journal_lines jl
      where jl.journal_entry_id = je.id
      group by jl.journal_entry_id
      having abs(coalesce(sum(coalesce(jl.debit,0)-coalesce(jl.credit,0)),0)) < 0.000001
    );
  raise notice 'SMOKE_PASS|ACC00|Posted balanced entries exist|0|{"posted_balanced":%}', v_cnt;

  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_supplier,null,null,null,null);
  raise notice 'SMOKE_PASS|STMT00|Supplier statement rows all|0|{"rows":%}', v_cnt;
  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_supplier,null,v_base,null,null);
  raise notice 'SMOKE_PASS|STMT01|Supplier statement rows base|0|{"rows":%}', v_cnt;
  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_supplier,null,'YER',null,null);
  raise notice 'SMOKE_PASS|STMT02|Supplier statement rows YER|0|{"rows":%}', v_cnt;

  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_customer,null,null,null,null);
  raise notice 'SMOKE_PASS|STMT10|Customer statement rows all|0|{"rows":%}', v_cnt;
  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_customer,null,v_base,null,null);
  raise notice 'SMOKE_PASS|STMT11|Customer statement rows base|0|{"rows":%}', v_cnt;
  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_customer,null,'USD',null,null);
  raise notice 'SMOKE_PASS|STMT12|Customer statement rows USD|0|{"rows":%}', v_cnt;
  select count(1) into v_cnt from public.party_ledger_statement_v2(v_party_customer,null,'YER',null,null);
  raise notice 'SMOKE_PASS|STMT13|Customer statement rows YER|0|{"rows":%}', v_cnt;
end $$;

select 'LOCAL_SCENARIO_SMOKE_OK' as ok_token;
