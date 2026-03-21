// Uses management API to deploy then service_role to test
const MGMT = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const SVC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDIyOTI3NiwiZXhwIjoyMDg1ODA1Mjc2fQ.f32j9AaFHXHm6APXXkd5nrqG-CtQF-cKaHH5L_4l-Yk';
const BASE = 'https://pmhivhtaoydfolseelyc.supabase.co';

async function mgmt(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

// Try service_role via REST
async function svcRpc(fn, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}` },
    body: JSON.stringify(args)
  });
  const b = await r.json();
  return { status: r.status, data: b };
}

async function main() {
  // First deploy the trace function
  console.log('Deploying trace function...');
  await mgmt(`
    CREATE OR REPLACE FUNCTION public.trace_return_error(p_return_id uuid)
    RETURNS TABLE(step int, result text, err text, state text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $fn$
    DECLARE
      v_ret record; v_order record;
      v_entry_id uuid; v_cash uuid; v_ar uuid; v_deposits uuid; v_sr uuid;
      v_base text; v_currency text; v_fx numeric := 1;
      v_net numeric; v_ret_amount numeric; v_total numeric; v_method text;
      v_paid numeric := 0; v_items jsonb; v_item jsonb;
      v_item_id text; v_qty numeric; v_sale record;
      v_batch record; v_mv_id uuid; v_wh uuid;
    BEGIN
      PERFORM set_config('app.accounting_bypass','1',true);
      
      BEGIN SELECT * INTO v_ret FROM public.sales_returns WHERE id=p_return_id;
        RETURN QUERY SELECT 1,'OK: status='||v_ret.status,'','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 1,'FAIL',SQLERRM,SQLSTATE; RETURN; END;
      
      IF v_ret.status='completed' THEN RETURN QUERY SELECT 1,'SKIP: done','',''; RETURN; END IF;
      IF v_ret.status='cancelled' THEN RETURN QUERY SELECT 1,'FAIL: cancelled','',''; RETURN; END IF;
      
      BEGIN SELECT * INTO v_order FROM public.orders WHERE id=v_ret.order_id;
        RETURN QUERY SELECT 2,'OK: order '||v_order.status,'','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 2,'FAIL',SQLERRM,SQLSTATE; RETURN; END;
      
      IF v_order.status<>'delivered' THEN RETURN QUERY SELECT 2,'FAIL: not delivered','',''; RETURN; END IF;
      
      BEGIN
        v_cash:=public.get_account_id_by_code('1010');
        v_ar:=public.get_account_id_by_code('1200');
        v_deposits:=public.get_account_id_by_code('2050');
        v_sr:=public.get_account_id_by_code('4026');
        RETURN QUERY SELECT 3,'OK: accounts','','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 3,'FAIL accounts',SQLERRM,SQLSTATE; RETURN; END;
      
      BEGIN
        v_base:=upper(coalesce(public.get_base_currency(),'SAR'));
        v_currency:=upper(coalesce(nullif(btrim(coalesce(v_order.currency,'')),''),v_base));
        v_net:=greatest(0,coalesce(nullif((v_order.data->>'subtotal')::numeric,null),coalesce(v_order.subtotal,0),0)
                        -coalesce(nullif((v_order.data->>'discountAmount')::numeric,null),coalesce(v_order.discount,0),0));
        v_ret_amount:=coalesce(nullif(v_ret.total_refund_amount,null),0);
        v_total:=v_ret_amount;
        RETURN QUERY SELECT 4,'OK: net='||v_net||' ret='||v_ret_amount,'','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 4,'FAIL amounts',SQLERRM,SQLSTATE; RETURN; END;
      
      IF v_ret_amount<=0 THEN RETURN QUERY SELECT 4,'FAIL: amount=0','',''; RETURN; END IF;
      
      v_method:=coalesce(nullif(trim(coalesce(v_ret.refund_method,'')),''),'cash');
      RETURN QUERY SELECT 5,'OK: method='||v_method,'','';
      
      IF v_method IN ('cash','network','kuraimi') THEN
        BEGIN
          SELECT coalesce(sum(p.amount),0) INTO v_paid FROM public.payments p
          WHERE p.direction='in' AND p.reference_table='orders' AND p.reference_id=v_order.id::text;
          RETURN QUERY SELECT 6,'OK: paid='||v_paid,'','';
          IF v_paid<=0 THEN RETURN QUERY SELECT 6,'FAIL: cash needs paid order','',''; RETURN; END IF;
        EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 6,'FAIL paid check',SQLERRM,SQLSTATE; RETURN; END;
      END IF;
      
      BEGIN
        INSERT INTO public.journal_entries(entry_date,memo,source_table,source_id,source_event,created_by,status)
        VALUES(now(),'Trace '||p_return_id::text,'sales_returns',p_return_id::text,'trace_v2',auth.uid(),'posted')
        ON CONFLICT(source_table,source_id,source_event) DO UPDATE SET memo=excluded.memo RETURNING id INTO v_entry_id;
        RETURN QUERY SELECT 7,'OK: journal_entry='||v_entry_id::text,'','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 7,'FAIL journal insert',SQLERRM,SQLSTATE; RETURN; END;
      
      BEGIN
        CASE v_method
          WHEN 'ar' THEN
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_sr,v_total,0,'debit');
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_ar,0,v_total,'credit');
          WHEN 'store_credit' THEN
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_sr,v_total,0,'debit');
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_deposits,0,v_total,'credit');
          ELSE
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_sr,v_total,0,'debit');
            INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,line_memo) VALUES(v_entry_id,v_cash,0,v_total,'credit');
        END CASE;
        RETURN QUERY SELECT 8,'OK: journal lines inserted','','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 8,'FAIL journal lines',SQLERRM,SQLSTATE; RETURN; END;
      
      BEGIN
        v_items:=v_ret.items;
        IF jsonb_typeof(v_items)='object' THEN v_items:=jsonb_build_array(v_items); END IF;
        IF jsonb_typeof(v_items) IS NULL OR jsonb_typeof(v_items)<>'array' THEN v_items:='[]'::jsonb; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
          v_item_id:=nullif(trim(coalesce(v_item->>'itemId',v_item->>'id','')), '');
          BEGIN v_qty:=coalesce(nullif((v_item->>'uomQtyInBase')::numeric,null),nullif((v_item->>'quantity')::numeric,null),0);
          EXCEPTION WHEN OTHERS THEN v_qty:=0; END;
        END LOOP;
        RETURN QUERY SELECT 9,'OK: items loop ok, count='||jsonb_array_length(v_items)::text,'','';
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 9,'FAIL items loop',SQLERRM,SQLSTATE; RETURN; END;
      
      BEGIN
        v_items:=v_ret.items;
        IF jsonb_typeof(v_items)='object' THEN v_items:=jsonb_build_array(v_items); END IF;
        IF jsonb_typeof(v_items) IS NULL OR jsonb_typeof(v_items)<>'array' THEN v_items:='[]'::jsonb; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
          v_item_id:=nullif(trim(coalesce(v_item->>'itemId',v_item->>'id','')), '');
          v_qty:=coalesce(nullif((v_item->>'uomQtyInBase')::numeric,null),nullif((v_item->>'quantity')::numeric,null),0);
          IF v_item_id IS NULL OR v_qty<=0 THEN CONTINUE; END IF;
          FOR v_sale IN
            SELECT im.id, im.quantity, im.batch_id, im.warehouse_id
            FROM public.inventory_movements im
            WHERE im.reference_table='orders' AND im.reference_id=v_ret.order_id::text
              AND im.movement_type='sale_out' AND im.item_id::text=v_item_id::text
            ORDER BY im.occurred_at LIMIT 1
          LOOP
            SELECT b.unit_cost INTO v_batch FROM public.batches b WHERE b.id=v_sale.batch_id;
            v_wh:=v_sale.warehouse_id;
            BEGIN
              INSERT INTO public.inventory_movements(item_id,movement_type,quantity,unit_cost,total_cost,reference_table,reference_id,occurred_at,created_by,data,batch_id,warehouse_id)
              VALUES(v_item_id,'return_in',v_qty,coalesce(v_batch.unit_cost,0),v_qty*coalesce(v_batch.unit_cost,0),'sales_returns',p_return_id::text,now(),auth.uid(),
                jsonb_build_object('orderId',v_ret.order_id::text,'sourceMovementId',v_sale.id::text),v_sale.batch_id,v_wh)
              RETURNING id INTO v_mv_id;
              RETURN QUERY SELECT 10,'OK: inv movement='||v_mv_id::text,'','';
            EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 10,'FAIL inv movement',SQLERRM,SQLSTATE; RETURN; END;
          END LOOP;
          EXIT;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 10,'FAIL inv loop',SQLERRM,SQLSTATE; RETURN; END;
      
    END;
    $fn$;
    GRANT EXECUTE ON FUNCTION public.trace_return_error(uuid) TO authenticated;
  `);
  console.log('✅ trace function deployed');
  
  const draft = await mgmt(`SELECT id FROM public.sales_returns WHERE status='draft' LIMIT 1`);
  const retId = draft[0]?.id;
  console.log('Testing return:', retId);
  
  // Call via service_role REST
  const res = await svcRpc('trace_return_error', { p_return_id: retId });
  console.log('Status:', res.status);
  if (Array.isArray(res.data)) {
    res.data.forEach(r => console.log(`  Step ${r.step}: ${r.result} | ${r.err||''} | ${r.state||''}`));
  } else {
    console.log('Response:', JSON.stringify(res.data).slice(0,500));
  }
}
main().catch(console.error);
