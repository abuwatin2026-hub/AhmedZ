const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

async function main() {
  // Deploy a debug wrapper that can be called from frontend with any user
  // Returns detailed text step report
  await sql(`
DROP FUNCTION IF EXISTS public.debug_process_return(uuid);
CREATE OR REPLACE FUNCTION public.debug_process_return(p_return_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ret record;
  v_order record;
  v_base_currency text;
  v_currency text;
  v_fx numeric := 1;
  v_order_subtotal numeric;
  v_order_discount numeric;
  v_order_net_subtotal numeric;
  v_return_subtotal numeric;
  v_refund_method text;
  v_items_jsonb jsonb;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_paid_total numeric := 0;
  v_entry_id uuid;
  v_cash uuid;
  v_ar uuid;
  v_deposits uuid;
  v_sales_returns_acct uuid;
  v_total_refund numeric;
  v_base_total_refund numeric;
  v_sale record;
  v_already numeric;
  v_needed numeric;
  v_free numeric;
  v_alloc numeric;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
begin
  -- SET bypass
  PERFORM set_config('app.accounting_bypass', '1', true);
  
  -- Step 1: load return
  select * into v_ret from public.sales_returns r where r.id = p_return_id;
  if not found then return 'FAIL step1: return not found'; end if;
  if v_ret.status = 'completed' then return 'SKIP: already completed'; end if;
  if v_ret.status = 'cancelled' then return 'FAIL step1: cancelled'; end if;
  
  -- Step 2: load order
  select * into v_order from public.orders o where o.id = v_ret.order_id;
  if not found then return 'FAIL step2: order not found'; end if;
  if coalesce(v_order.status,'') <> 'delivered' then return 'FAIL step2: order status=' || v_order.status; end if;
  
  -- Step 3: account codes
  begin
    v_cash := public.get_account_id_by_code('1010');
    v_ar := public.get_account_id_by_code('1200');
    v_deposits := public.get_account_id_by_code('2050');
    v_sales_returns_acct := public.get_account_id_by_code('4026');
  exception when others then
    return 'FAIL step3 account codes: ' || SQLERRM;
  end;
  
  -- Step 4: currency
  begin
    v_base_currency := upper(coalesce(public.get_base_currency(), 'SAR'));
    v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency,'')),''),(v_base_currency)));
  exception when others then
    return 'FAIL step4 currency: ' || SQLERRM;
  end;
  
  -- Step 5: amounts
  v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric,null), coalesce(v_order.subtotal,0), 0);
  v_order_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric,null), coalesce(v_order.discount,0), 0);
  v_order_net_subtotal := greatest(0, v_order_subtotal - v_order_discount);
  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount,null),0);
  if v_return_subtotal <= 0 then return 'FAIL step5: amount=' || v_return_subtotal; end if;
  v_total_refund := v_return_subtotal;
  v_base_total_refund := v_total_refund * v_fx;
  
  -- Step 6: refund method
  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method,'')),'' ),'cash');
  
  -- Step 7: cash check
  if v_refund_method in ('cash','network','kuraimi') then
    begin
      select coalesce(sum(p.amount),0) into v_paid_total
      from public.payments p
      where p.direction='in' and p.reference_table='orders' and p.reference_id=v_order.id::text;
    exception when others then v_paid_total := 0;
    end;
    if v_paid_total <= 0 then return 'FAIL step7: cash/bank refund requires paid order, paid=' || v_paid_total; end if;
  end if;
  
  -- Step 8: journal entry insert
  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (now(), 'Debug sales return ' || p_return_id::text, 'sales_returns', p_return_id::text, 'debug_full', auth.uid(), 'posted')
    on conflict (source_table, source_id, source_event) do update set memo=excluded.memo
    returning id into v_entry_id;
    -- insert a minimal journal line
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales_returns_acct, v_base_total_refund, 0, 'Sales return debug');
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, 0, v_base_total_refund, 'AR reduce debug');
    -- rollback journal changes
    delete from public.journal_lines where journal_entry_id = v_entry_id;
    delete from public.journal_entries where id = v_entry_id;
  exception when others then
    return 'FAIL step8 journal: ' || SQLERRM || ' SQLSTATE=' || SQLSTATE;
  end;
  
  -- Step 9: items loop
  v_items_jsonb := v_ret.items;
  if jsonb_typeof(v_items_jsonb) = 'object' then v_items_jsonb := jsonb_build_array(v_items_jsonb); end if;
  if jsonb_typeof(v_items_jsonb) is null or jsonb_typeof(v_items_jsonb) <> 'array' then v_items_jsonb := '[]'::jsonb; end if;
  
  for v_item in select value from jsonb_array_elements(v_items_jsonb)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id', '')), '');
    begin
      v_qty := coalesce(nullif((v_item->>'uomQtyInBase')::numeric,null), nullif((v_item->>'quantity')::numeric,null), 0);
    exception when others then v_qty := 0; end;
    if v_item_id is null or v_qty <= 0 then continue; end if;
    
    v_needed := v_qty;
    
    for v_sale in
      select im.id, im.quantity, im.batch_id, im.warehouse_id
      from public.inventory_movements im
      where im.reference_table = 'orders' and im.reference_id = v_ret.order_id::text
        and im.movement_type = 'sale_out' and im.item_id::text = v_item_id::text
      order by im.occurred_at asc limit 1
    loop
      exit when v_needed <= 0;
      select coalesce(sum(imr.quantity),0) into v_already
      from public.inventory_movements imr
      where imr.reference_table='sales_returns' and imr.movement_type='return_in'
        and (imr.data->>'orderId')=v_ret.order_id::text and (imr.data->>'sourceMovementId')=v_sale.id::text;
      v_free := greatest(coalesce(v_sale.quantity,0)-coalesce(v_already,0),0);
      if v_free <= 0 then continue; end if;
      v_alloc := least(v_needed, v_free);
      
      select b.unit_cost into v_source_batch from public.batches b where b.id = v_sale.batch_id;
      v_wh := v_sale.warehouse_id;
      
      -- Try insert inventory movement
      begin
        insert into public.inventory_movements(item_id, movement_type, quantity, unit_cost, total_cost, reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id)
        values (v_item_id::text, 'return_in', v_alloc, coalesce(v_source_batch.unit_cost,0), v_alloc*coalesce(v_source_batch.unit_cost,0),
          'sales_returns', v_ret.id::text, now(), auth.uid(),
          jsonb_build_object('orderId', v_ret.order_id::text, 'sourceMovementId', v_sale.id::text),
          v_sale.batch_id, v_wh)
        returning id into v_movement_id;
        -- immediately delete test movement
        delete from public.inventory_movements where id = v_movement_id;
      exception when others then
        return 'FAIL step9 inventory movement insert: ' || SQLERRM || ' SQLSTATE=' || SQLSTATE;
      end;
      
      v_needed := v_needed - v_alloc;
    end loop;
  end loop;
  
  return 'OK: all steps passed | return=' || p_return_id || ' | method=' || v_refund_method || ' | amount=' || v_return_subtotal;
end;
$function$;
GRANT EXECUTE ON FUNCTION public.debug_process_return(uuid) TO authenticated;
  `);
  console.log('✅ debug_process_return deployed');
  
  // Test it via service_role
  const draft = await sql(`SELECT id FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 1`);
  const retId = draft[0]?.id;
  const result = await sql(`SELECT public.debug_process_return('${retId}'::uuid)`);
  console.log('Service role result:', result[0]['debug_process_return']);
}
main().catch(console.error);
