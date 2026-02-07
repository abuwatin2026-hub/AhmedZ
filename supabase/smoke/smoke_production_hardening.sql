do $$
declare
  v_owner uuid;
  v_other uuid;
  v_wh uuid;
  v_item_id text;
  v_batch_id uuid;
  v_im_id uuid;
  v_je_id uuid;
  v_jm_id uuid;
  v_payment_id uuid;
  v_expense_id uuid;
  v_base text;
  v_base_high boolean := false;
  v_cur text;
  v_cnt int := 0;
begin
  select u.id
  into v_owner
  from auth.users u
  where lower(u.email) = lower('owner@azta.com')
  limit 1;

  if v_owner is null then
    raise exception 'smoke requires auth.users row for owner@azta.com';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set role authenticated;

  select public._resolve_default_admin_warehouse_id() into v_wh;
  if v_wh is null then
    insert into public.warehouses(code, name, type, is_active)
    values ('MAIN', 'Main Warehouse', 'main', true)
    on conflict (code) do update set is_active = excluded.is_active;
    select public._resolve_default_admin_warehouse_id() into v_wh;
  end if;
  if v_wh is null then
    raise exception 'smoke requires an active warehouse';
  end if;

  v_item_id := 'SMOKE-HARDEN-' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.menu_items(
      id, category, unit_type, base_unit, status, name, price, is_food, expiry_required, sellable, data
    )
    values (
      v_item_id,
      'qat',
      'piece',
      'piece',
      'active',
      jsonb_build_object('ar','صنف اختبار تقسية إنتاج','en','Production Hardening Item'),
      100,
      false,
      false,
      true,
      jsonb_build_object(
        'id', v_item_id,
        'name', jsonb_build_object('ar','صنف اختبار تقسية إنتاج','en','Production Hardening Item'),
        'price', 100,
        'category', 'qat',
        'unitType', 'piece',
        'status', 'active',
        'sellable', true,
        'expiry_required', false
      )
    );
  exception when undefined_column then
    insert into public.menu_items(id, category, unit_type, status, data)
    values (
      v_item_id,
      'qat',
      'piece',
      'active',
      jsonb_build_object('id', v_item_id, 'name', jsonb_build_object('ar','صنف اختبار تقسية إنتاج'), 'price', 100)
    );
  end;

  insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
  values (v_item_id, public.get_or_create_uom('piece'), null, null)
  on conflict (item_id) do nothing;

  v_batch_id := gen_random_uuid();
  insert into public.batches(id, item_id, warehouse_id, quantity_received, quantity_consumed, unit_cost, data)
  values (v_batch_id, v_item_id, v_wh, 10, 0, 100, '{}'::jsonb);

  insert into public.inventory_movements(
    item_id, movement_type, quantity, unit_cost, total_cost,
    reference_table, reference_id, occurred_at, created_by, data,
    batch_id, warehouse_id
  )
  values (
    v_item_id, 'adjust_in', 1, 100, 100,
    'smoke', v_batch_id::text, now(), v_owner, '{}'::jsonb,
    v_batch_id, v_wh
  )
  returning id into v_im_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (current_date, 'smoke posted inventory movement', 'inventory_movements', v_im_id::text, 'post', v_owner)
  returning id into v_je_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_je_id, public.get_account_id_by_code('1410'), 100, 0, 'inventory'),
    (v_je_id, public.get_account_id_by_code('5010'), 0, 100, 'offset');

  begin
    update public.inventory_movements
    set data = jsonb_set(coalesce(data,'{}'::jsonb), '{smoke}', 'true'::jsonb, true)
    where id = v_im_id;
    raise exception 'expected inventory movement update to fail';
  exception when others then
    if position('cannot modify posted inventory movement; create reversal instead' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    delete from public.inventory_movements where id = v_im_id;
    raise exception 'expected inventory movement delete to fail';
  exception when others then
    if position('cannot modify posted inventory movement; create reversal instead' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (current_date, 'smoke manual entry for journal_lines constraints', 'manual', gen_random_uuid()::text, 'smoke', v_owner)
  returning id into v_jm_id;

  begin
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_jm_id, public.get_account_id_by_code('1010'), 1, 1, 'invalid both sides');
    raise exception 'expected invalid journal_lines insert to fail';
  exception when check_violation then
    null;
  when others then
    if sqlstate <> '23514' then
      raise;
    end if;
  end;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_jm_id, public.get_account_id_by_code('1010'), 1, 0, 'valid debit'),
    (v_jm_id, public.get_account_id_by_code('4010'), 0, 1, 'valid credit');

  begin
    insert into public.currencies(code, name, is_base, is_high_inflation)
    values ('USD', 'USD', false, false)
    on conflict (code) do update set is_high_inflation = excluded.is_high_inflation;
  exception when undefined_column then
    insert into public.currencies(code, name, is_base)
    values ('USD', 'USD', false)
    on conflict (code) do nothing;
  end;

  begin
    insert into public.currencies(code, name, is_base, is_high_inflation)
    values ('YER', 'YER', false, true)
    on conflict (code) do update set is_high_inflation = excluded.is_high_inflation;
  exception when undefined_column then
    insert into public.currencies(code, name, is_base)
    values ('YER', 'YER', false)
    on conflict (code) do nothing;
  end;

  v_base := public.get_base_currency();
  select coalesce(c.is_high_inflation, false)
  into v_base_high
  from public.currencies c
  where upper(c.code) = upper(v_base)
  limit 1;

  if v_base_high then
    v_cur := 'USD';
  else
    v_cur := 'YER';
  end if;

  begin
    begin
      insert into public.fx_rates(currency_code, rate_date, rate_type, rate, created_by)
      values (v_cur, current_date, 'operational', 1, v_owner);
    exception when undefined_column then
      insert into public.fx_rates(currency_code, rate_date, rate_type, rate)
      values (v_cur, current_date, 'operational', 1);
    end;
    raise exception 'expected fx_rates wrong-direction insert to fail';
  exception when others then
    if position('fx rate direction invalid' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  insert into public.expenses(title, amount, category, date, notes, created_by)
  values ('smoke expense for payments rls', 10, 'other', current_date, null, v_owner)
  returning id into v_expense_id;

  perform public.record_expense_payment(v_expense_id, 10, 'card', now());

  select p.id
  into v_payment_id
  from public.payments p
  where p.reference_table = 'expenses'
    and p.reference_id = v_expense_id::text
  order by p.created_at desc
  limit 1;

  v_other := gen_random_uuid();
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set role authenticated;

  select count(1) into v_cnt from public.payments p where p.id = v_payment_id;
  if v_cnt <> 0 then
    raise exception 'payments RLS failed: unauthorized user can read payment %', v_payment_id::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
