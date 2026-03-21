const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

// Fix: create 6 remaining AR open items with correct column names
const repairSQL = `
do $$
declare
  v_order record;
  v_je_id uuid;
  v_cnt int := 0;
begin
  for v_order in
    SELECT o.id, o.base_total, o.due_date, upper(coalesce(nullif(o.currency,''), 'SAR')) as currency
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND lower(coalesce(o.data->>'invoiceTerms','')) = 'credit'
      AND NOT EXISTS (SELECT 1 FROM public.ar_open_items aoi WHERE aoi.invoice_id = o.id)
    ORDER BY o.created_at
  loop
    SELECT je.id INTO v_je_id
    FROM public.journal_entries je
    WHERE je.source_table = 'orders' AND je.source_id = v_order.id::text
    ORDER BY je.entry_date DESC LIMIT 1;

    if v_je_id is null then continue; end if;

    INSERT INTO public.ar_open_items(invoice_id, journal_entry_id, original_amount, open_balance, currency, status)
    VALUES (v_order.id, v_je_id, v_order.base_total, v_order.base_total, v_order.currency, 'open')
    ON CONFLICT DO NOTHING;

    v_cnt := v_cnt + 1;
    raise notice 'Created AR for order %', v_order.id;
  end loop;

  raise notice 'Done: % AR items created', v_cnt;
end;
$$;
`;

try {
  await sql(repairSQL);
  console.log('✅ AR open items repair done\n');
} catch (e) {
  console.error('❌ Error:', e.message);
}

// Verify final state
const v = (await sql(`
  SELECT
    (SELECT COUNT(*) FROM public.orders o WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as total,
    (SELECT COUNT(DISTINCT o.id) FROM public.orders o JOIN public.journal_entries je ON je.source_table='orders' AND je.source_id=o.id::text WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as with_je,
    (SELECT COUNT(DISTINCT o.id) FROM public.orders o JOIN public.ar_open_items aoi ON aoi.invoice_id=o.id WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as with_ar,
    (SELECT COALESCE(SUM(o.base_total),0) FROM public.orders o WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as base_total,
    (SELECT COALESCE(SUM(aoi.open_balance),0) FROM public.ar_open_items aoi JOIN public.orders o ON aoi.invoice_id=o.id WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as ar_balance,
    (SELECT COALESCE(SUM(jl.debit),0) FROM public.orders o JOIN public.journal_entries je ON je.source_table='orders' AND je.source_id=o.id::text JOIN public.journal_lines jl ON jl.journal_entry_id=je.id JOIN public.chart_of_accounts a ON a.id=jl.account_id AND a.code='1200' WHERE o.status='delivered' AND lower(coalesce(o.data->>'invoiceTerms',''))='credit') as ar_debit
`))[0];

console.log('══════ التحقق النهائي ══════');
console.log(`طلبات آجلة مسلمة: ${v.total}`);
console.log(`لها قيد محاسبي: ${v.with_je} ${v.with_je == v.total ? '✅' : '⚠️'}`);
console.log(`لها AR open item: ${v.with_ar} ${v.with_ar == v.total ? '✅' : '⚠️'}`);
console.log(`base_total: ${Number(v.base_total).toFixed(2)}`);
console.log(`AR open balance: ${Number(v.ar_balance).toFixed(2)}`);
console.log(`JE 1200 debit: ${Number(v.ar_debit).toFixed(2)}`);
const d1 = Math.abs(Number(v.base_total) - Number(v.ar_balance));
const d2 = Math.abs(Number(v.base_total) - Number(v.ar_debit));
console.log(`فرق base vs AR: ${d1.toFixed(2)} ${d1 < 1 ? '✅' : '⚠️'}`);
console.log(`فرق base vs JE: ${d2.toFixed(2)} ${d2 < 1 ? '✅' : '⚠️'}`);
