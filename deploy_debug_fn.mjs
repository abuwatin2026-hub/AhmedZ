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
  // Deploy a debug version of process_sales_return that raises NOTICE at each stage
  // This will show us where it fails
  
  await sql(`
CREATE OR REPLACE FUNCTION public.process_sales_return_debug(p_return_id uuid)
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
  v_fx numeric;
  v_order_subtotal numeric;
  v_order_discount numeric;
  v_order_net_subtotal numeric;
  v_order_tax numeric;
  v_return_subtotal numeric;
  v_refund_method text;
  v_items_jsonb jsonb;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_sale record;
  v_already numeric;
  v_needed numeric;
  v_free numeric;
  v_alloc numeric;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_sales_returns uuid;
  v_vat_payable uuid;
  v_tax_refund numeric;
  v_total_refund numeric;
  v_base_return_subtotal numeric;
  v_base_tax_refund numeric;
  v_base_total_refund numeric;
  v_paid_total numeric := 0;
  v_prev_refunded_total numeric := 0;
  v_ar_reduction numeric := 0;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
  v_shift_id uuid;
begin
  -- STAGE 1: Load return
  select * into v_ret from public.sales_returns r where r.id = p_return_id;
  if not found then return 'FAIL: sales return not found'; end if;
  if v_ret.status = 'completed' then return 'SKIP: already completed'; end if;
  if v_ret.status = 'cancelled' then return 'FAIL: cancelled'; end if;

  -- STAGE 2: Load order  
  select * into v_order from public.orders o where o.id = v_ret.order_id;
  if not found then return 'FAIL: order not found'; end if;
  if coalesce(v_order.status,'') <> 'delivered' then return 'FAIL: order not delivered, status=' || v_order.status; end if;

  -- STAGE 3: Account codes
  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales_returns := public.get_account_id_by_code('4026');
  v_vat_payable := public.get_account_id_by_code('2020');

  -- STAGE 4: Currency / FX
  v_base_currency := upper(coalesce(public.get_base_currency(), 'YER'));
  v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency,'')),''),(v_base_currency)));
  v_fx := 1;

  -- STAGE 5: Calculate amounts
  v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric,null), coalesce(v_order.subtotal,0), 0);
  v_order_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric,null), coalesce(v_order.discount,0), 0);
  v_order_net_subtotal := greatest(0, v_order_subtotal - v_order_discount);
  v_order_tax := coalesce(nullif((v_order.data->>'taxAmount')::numeric,null), coalesce(v_order.tax_amount,0), 0);
  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount,null),0);
  
  if v_return_subtotal <= 0 then return 'FAIL: invalid return amount=' || v_return_subtotal; end if;
  -- Don't check over-amount - just note it
  
  v_tax_refund := 0;
  v_total_refund := v_return_subtotal + v_tax_refund;
  v_base_return_subtotal := v_return_subtotal * v_fx;
  v_base_total_refund := v_total_refund * v_fx;
  v_base_tax_refund := 0;

  -- STAGE 6: Refund method
  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method,'')),'' ),'cash');
  
  -- STAGE 7: Check paid amount IF cash/bank refund
  if v_refund_method in ('cash','network','kuraimi') then
    select coalesce(sum(p.amount),0) into v_paid_total
    from public.payments p
    where p.direction='in' and p.reference_table='orders' and p.reference_id=v_order.id::text;
    if v_paid_total <= 0 then return 'FAIL: cash refund requires paid order, paid=' || v_paid_total || ' method=' || v_refund_method; end if;
  end if;
  
  -- STAGE 8: Items jsonb type check
  v_items_jsonb := v_ret.items;
  if jsonb_typeof(v_items_jsonb) IS NULL then return 'FAIL: items is null'; end if;
  if jsonb_typeof(v_items_jsonb) = 'object' then
    v_items_jsonb := jsonb_build_array(v_items_jsonb);
  elsif jsonb_typeof(v_items_jsonb) <> 'array' then
    return 'FAIL: items is not array or object, type=' || jsonb_typeof(v_items_jsonb);
  end if;
  
  -- STAGE 9: Try items loop
  begin
    for v_item in select value from jsonb_array_elements(v_items_jsonb)
    loop
      v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id', '')), '');
      begin
        v_qty := coalesce(
          nullif((v_item->>'uomQtyInBase')::numeric,null),
          nullif((v_item->>'quantity')::numeric,null),
          0
        );
      exception when others then
        v_qty := 0;
      end;
    end loop;
  exception when others then
    return 'FAIL in items loop: ' || SQLERRM || ' SQLSTATE=' || SQLSTATE;
  end;
  
  -- STAGE 10: Journal entry
  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (coalesce(v_ret.return_date,now()), 'Debug return ' || p_return_id::text, 'sales_returns', v_ret.id::text, 'debug_test', auth.uid(), 'draft')
    on conflict (source_table, source_id, source_event) do update set memo=excluded.memo
    returning id into v_entry_id;
    -- rollback immediately, we just test
    delete from public.journal_entries where id = v_entry_id;
  exception when others then
    return 'FAIL at journal_entries insert: ' || SQLERRM;
  end;
  
  return 'OK: all stages passed | items_count=' || jsonb_array_length(v_items_jsonb) || ' | refund_method=' || v_refund_method || ' | amount=' || v_return_subtotal;
end;
$function$;
GRANT EXECUTE ON FUNCTION public.process_sales_return_debug(uuid) TO authenticated;
  `);
  console.log('Debug function deployed');
  
  // Now run it on the draft return
  const drafts = await sql(`SELECT id FROM public.sales_returns WHERE status='draft' LIMIT 3`);
  for (const d of drafts) {
    const result = await sql(`SELECT public.process_sales_return_debug('${d.id}'::uuid) as result`);
    console.log(`Return ${d.id.slice(-8)}: ${result[0].result}`);
  }
}
main().catch(console.error);
