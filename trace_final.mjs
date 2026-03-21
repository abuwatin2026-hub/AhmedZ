const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const PROJECT = 'pmhivhtaoydfolseelyc';

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

async function main() {
  // Try Supabase logs API
  const logRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/analytics/endpoints/logs.all?iso_timestamp_start=${new Date(Date.now()-600000).toISOString()}&project_ref=${PROJECT}&sql=select+timestamp,+event_message+from+edge_logs+where+event_message+like+'%25cannot extract%25'+order+by+timestamp+desc+limit+10`,
    { headers: { Authorization: `Bearer ${SBP}` } }
  );
  console.log('Log API status:', logRes.status);
  if (logRes.ok) {
    const logs = await logRes.json();
    console.log('Logs:', JSON.stringify(logs).slice(0, 1000));
  }
  
  // Try analytics via known endpoint
  const logsRes2 = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/analytics/endpoints/logs.all?period_start=${new Date(Date.now()-3600000).toISOString()}&period_end=${new Date().toISOString()}`,
    { headers: { Authorization: `Bearer ${SBP}` } }
  );
  console.log('Log API 2 status:', logsRes2.status);
  
  // --- MAIN GOAL: trace EXACT error line ---
  // Strategy: Install a patched version of the function with RAISE NOTICE at each step
  // Use a custom "stepping" approach
  
  const draft = await sql(`SELECT id, order_id, refund_method FROM public.sales_returns WHERE status='draft' LIMIT 1`);
  const retId = draft[0]?.id;
  const ordId = draft[0]?.order_id;
  const method = draft[0]?.refund_method;
  console.log(`\nReturn: ${retId} | order: ${ordId} | method: ${method}`);
  
  // Deploy a final debug function that wraps every single step
  // and returns exactly where it fails, with the full SQLERRM
  await sql(`
    CREATE OR REPLACE FUNCTION public.trace_return_error(p_return_id uuid)
    RETURNS TABLE(step int, result text, sqlerrm text, sqlstate text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $fn$
    DECLARE
      v_ret record;
      v_order record;
      v_entry_id uuid;
      v_cash uuid; v_ar uuid; v_deposits uuid; v_sr uuid; v_vat uuid;
      v_currency text; v_base text := 'SAR'; v_fx numeric := 1;
      v_subtotal numeric; v_discount numeric; v_net numeric;
      v_ret_amount numeric; v_tax numeric := 0; v_total numeric;
      v_method text;
      v_paid numeric := 0;
      v_items jsonb; v_item jsonb; v_item_id text; v_qty numeric;
    BEGIN
      PERFORM set_config('app.accounting_bypass','1',true);
      
      -- step 1
      BEGIN
        SELECT * INTO v_ret FROM public.sales_returns WHERE id=p_return_id;
        RETURN QUERY SELECT 1,'OK: return loaded, status='||v_ret.status,'','' ;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 1,'FAIL',SQLERRM,SQLSTATE;
        RETURN;
      END;
      
      IF v_ret.status = 'completed' THEN RETURN QUERY SELECT 1,'SKIP: completed','',''; RETURN; END IF;
      
      -- step 2
      BEGIN
        SELECT * INTO v_order FROM public.orders WHERE id=v_ret.order_id;
        RETURN QUERY SELECT 2,'OK: order='||v_order.status||' currency='||coalesce(v_order.currency,'NULL'),'','' ;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 2,'FAIL',SQLERRM,SQLSTATE; RETURN;
      END;
      
      -- step 3
      BEGIN
        v_cash := public.get_account_id_by_code('1010');
        v_ar := public.get_account_id_by_code('1200');
        v_deposits := public.get_account_id_by_code('2050');
        v_sr := public.get_account_id_by_code('4026');
        v_vat := public.get_account_id_by_code('2020');
        RETURN QUERY SELECT 3,'OK: accounts loaded','','';
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 3,'FAIL',SQLERRM,SQLSTATE; RETURN;
      END;
      
      -- step 4: amounts
      BEGIN
        v_base := upper(coalesce(public.get_base_currency(),'SAR'));
        v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency,'')),''),v_base));
        v_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric,null),coalesce(v_order.subtotal,0),0);
        v_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric,null),coalesce(v_order.discount,0),0);
        v_net := greatest(0, v_subtotal - v_discount);
        v_ret_amount := coalesce(nullif(v_ret.total_refund_amount,null),0);
        v_total := v_ret_amount;
        RETURN QUERY SELECT 4,'OK: amounts net='||v_net||' ret='||v_ret_amount,'','';
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 4,'FAIL',SQLERRM,SQLSTATE; RETURN;
      END;
      
      IF v_ret_amount <= 0 THEN RETURN QUERY SELECT 4,'FAIL: amount=0','',''; RETURN; END IF;
      
      -- step 5: method
      v_method := coalesce(nullif(trim(coalesce(v_ret.refund_method,'')),''),'cash');
      RETURN QUERY SELECT 5,'OK: method='||v_method,'','';
      
      -- step 6: cash check
      IF v_method IN ('cash','network','kuraimi') THEN
        BEGIN
          SELECT coalesce(sum(p.amount),0) INTO v_paid FROM public.payments p
          WHERE p.direction='in' AND p.reference_table='orders' AND p.reference_id=v_order.id::text;
          RETURN QUERY SELECT 6,'OK: paid='||v_paid,'','';
          IF v_paid <= 0 THEN RETURN QUERY SELECT 6,'FAIL: cash needs paid order, paid='||v_paid,'',''; RETURN; END IF;
        EXCEPTION WHEN OTHERS THEN
          RETURN QUERY SELECT 6,'FAIL',SQLERRM,SQLSTATE; RETURN;
        END;
      END IF;
      
      -- step 7: journal entry
      BEGIN
        INSERT INTO public.journal_entries(entry_date,memo,source_table,source_id,source_event,created_by,status)
        VALUES (now(),'Trace '||p_return_id::text,'sales_returns',p_return_id::text,'trace_test',auth.uid(),'posted')
        ON CONFLICT (source_table,source_id,source_event) DO UPDATE SET memo=excluded.memo
        RETURNING id INTO v_entry_id;
        INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo)
        VALUES (v_entry_id,v_sr,v_total,0,'debit');
        CASE v_method
          WHEN 'ar' THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES (v_entry_id,v_ar,0,v_total,'credit');
          WHEN 'store_credit' THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES (v_entry_id,v_deposits,0,v_total,'credit');
          ELSE INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES (v_entry_id,v_cash,0,v_total,'credit');
        END CASE;
        RETURN QUERY SELECT 7,'OK: journal entry='||v_entry_id::text,'','';
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 7,'FAIL',SQLERRM,SQLSTATE; RETURN;
      END;
      
      -- step 8: items loop (no-op just parse)
      BEGIN
        v_items := v_ret.items;
        IF jsonb_typeof(v_items) = 'object' THEN v_items := jsonb_build_array(v_items); END IF;
        IF jsonb_typeof(v_items) IS NULL OR jsonb_typeof(v_items) <> 'array' THEN v_items := '[]'::jsonb; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
          v_item_id := nullif(trim(coalesce(v_item->>'itemId',v_item->>'id','')), '');
          BEGIN v_qty := coalesce(nullif((v_item->>'uomQtyInBase')::numeric,null),nullif((v_item->>'quantity')::numeric,null),0);
          EXCEPTION WHEN OTHERS THEN v_qty := 0; END;
        END LOOP;
        RETURN QUERY SELECT 8,'OK: items loop done, count='||jsonb_array_length(v_items)::text,'','';
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 8,'FAIL items loop',SQLERRM,SQLSTATE; RETURN;
      END;
      
      -- step 9: inventory movement test insert
      DECLARE
        v_sale record; v_wh uuid; v_batch record; v_mv_id uuid;
      BEGIN
        v_items := v_ret.items;
        IF jsonb_typeof(v_items)='object' THEN v_items:=jsonb_build_array(v_items); END IF;
        IF jsonb_typeof(v_items) IS NULL OR jsonb_typeof(v_items)<>'array' THEN v_items:='[]'::jsonb; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
          v_item_id := nullif(trim(coalesce(v_item->>'itemId',v_item->>'id','')), '');
          v_qty := coalesce(nullif((v_item->>'uomQtyInBase')::numeric,null),nullif((v_item->>'quantity')::numeric,null),0);
          EXIT WHEN v_item_id IS NULL OR v_qty <= 0;
          FOR v_sale IN
            SELECT im.id, im.quantity, im.batch_id, im.warehouse_id FROM public.inventory_movements im
            WHERE im.reference_table='orders' AND im.reference_id=v_ret.order_id::text
              AND im.movement_type='sale_out' AND im.item_id::text=v_item_id::text
            ORDER BY im.occurred_at LIMIT 1
          LOOP
            SELECT b.unit_cost INTO v_batch FROM public.batches b WHERE b.id=v_sale.batch_id;
            v_wh := v_sale.warehouse_id;
            BEGIN
              INSERT INTO public.inventory_movements(item_id,movement_type,quantity,unit_cost,total_cost,reference_table,reference_id,occurred_at,created_by,data,batch_id,warehouse_id)
              VALUES (v_item_id,'return_in',v_qty,coalesce(v_batch.unit_cost,0),v_qty*coalesce(v_batch.unit_cost,0),'sales_returns',p_return_id::text,now(),auth.uid(),
                jsonb_build_object('orderId',v_ret.order_id::text,'sourceMovementId',v_sale.id::text),v_sale.batch_id,v_wh)
              RETURNING id INTO v_mv_id;
              RETURN QUERY SELECT 9,'OK: inventory movement inserted='||v_mv_id::text,'','';
            EXCEPTION WHEN OTHERS THEN
              RETURN QUERY SELECT 9,'FAIL inv movement',SQLERRM,SQLSTATE; RETURN;
            END;
          END LOOP;
          EXIT;
        END LOOP;
      END;
    END;
    $fn$;
    GRANT EXECUTE ON FUNCTION public.trace_return_error(uuid) TO authenticated;
  `);
  console.log('✅ trace_return_error deployed');
  
  // Now test it
  const result = await sql(`SELECT * FROM public.trace_return_error('${retId}'::uuid) ORDER BY step`);
  console.log('\nTrace result:');
  result.forEach(r => console.log(`  Step ${r.step}: ${r.result} | sqlerrm: ${r.sqlerrm||''} | sqlstate: ${r.sqlstate||''}`));
}
main().catch(console.error);
