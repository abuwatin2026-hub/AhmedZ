const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}
async function main() {
  const id = '499fb7ad-2155-499f-b5c7-c1df4a41d65c';

  // 1. الأرقام المباشرة من قاعدة البيانات بدون حسابات
  console.log('=== 1. purchase_receipt_items (مباشر) ===');
  const pri = await sql(`SELECT quantity, qty_base, uom_id, unit_cost FROM purchase_receipt_items WHERE item_id='${id}'`);
  pri.forEach(p => console.log(`  quantity=${p.quantity} | qty_base=${p.qty_base} | معامل=${parseFloat(p.qty_base)/parseFloat(p.quantity)}`));
  console.log(`  المجموع qty=${pri.reduce((s,p)=>s+parseFloat(p.quantity),0)} | qty_base=${pri.reduce((s,p)=>s+parseFloat(p.qty_base),0)}`);

  // 2. inventory_movements مباشرة كاملاً
  console.log('\n=== 2. inventory_movements (كاملاً Raw) ===');
  const mvs = await sql(`
    SELECT movement_type, quantity, qty_base, warehouse_id, reference_id, created_at
    FROM inventory_movements WHERE item_id='${id}' ORDER BY created_at
  `);
  mvs.forEach((m,i) => console.log(`  ${i+1}. ${m.movement_type} | qty=${m.quantity} | qty_base=${m.qty_base} | wh=${m.warehouse_id?.slice(0,8)} | ref=${m.reference_id?.slice(0,8)}`));

  // 3. حساب يدوي باستخدام SQL مباشرة
  console.log('\n=== 3. حساب SQL مباشر من inventory_movements ===');
  const calcSQL = await sql(`
    SELECT 
      warehouse_id,
      SUM(CASE WHEN movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN quantity ELSE 0 END) as total_in,
      SUM(CASE WHEN movement_type IN ('sale_out','transfer_out','return_out','adjust_out') THEN quantity ELSE 0 END) as total_out,
      SUM(CASE WHEN movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN quantity ELSE -quantity END) as net
    FROM inventory_movements WHERE item_id='${id}'
    GROUP BY warehouse_id
    ORDER BY net DESC
  `);
  let grandNet = 0;
  for (const c of calcSQL) {
    const wh = await sql(`SELECT name::text FROM warehouses WHERE id='${c.warehouse_id}'`).catch(()=>[{name:'-'}]);
    const wName = wh[0]?.name?.match(/"ar":\s*"([^"]+)"/)?.[1] || c.warehouse_id?.slice(0,8);
    grandNet += parseFloat(c.net);
    console.log(`  ${wName}: وارد=${c.total_in} | صادر=${c.total_out} | صافي=${c.net}`);
  }
  console.log(`  الصافي الكلي: ${grandNet}`);

  // 4. stock_management المباشر
  console.log('\n=== 4. stock_management (مباشر) ===');
  const sm = await sql(`SELECT warehouse_id, available_quantity, unit FROM stock_management WHERE item_id='${id}'`);
  let totalSM = 0;
  for (const s of sm) {
    const wh = await sql(`SELECT name::text FROM warehouses WHERE id='${s.warehouse_id}'`).catch(()=>[{name:'-'}]);
    const wName = wh[0]?.name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    totalSM += parseFloat(s.available_quantity);
    const net = calcSQL.find(c=>c.warehouse_id===s.warehouse_id);
    const diff = parseFloat(s.available_quantity) - (net ? parseFloat(net.net) : 0);
    console.log(`  ${wName}: available=${s.available_quantity} | net_moves=${net?.net||'?'} | فرق=${diff>0?'+':''}${diff} ${Math.abs(diff)<0.5?'✅':'❌'}`);
  }
  console.log(`  إجمالي stock_management: ${totalSM}`);
  console.log(`  إجمالي من الحركات: ${grandNet}`);
  console.log(`  الفرق: ${totalSM - grandNet}`);

  // 5. تحقق المشتريات مع أي فواتير شراء أخرى
  console.log('\n=== 5. كل المصادر التي purchase_in جاء منها ===');
  const purMvs = await sql(`SELECT quantity, qty_base, reference_id, reference_table FROM inventory_movements WHERE item_id='${id}' AND movement_type='purchase_in'`);
  console.log(`  عدد حركات الشراء: ${purMvs.length}`);
  purMvs.forEach(m => console.log(`  qty=${m.quantity} | base=${m.qty_base} | ref=${m.reference_id?.slice(0,8)} | table=${m.reference_table}`));

  // 6. هل هناك journal entries أو بيانات أخرى؟
  console.log('\n=== 6. journal_lines المرتبطة ===');
  const jl = await sql(`
    SELECT je.description, jl.debit, jl.credit, jl.created_at
    FROM journal_lines jl 
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE je.reference_id IN (SELECT reference_id FROM inventory_movements WHERE item_id='${id}' AND movement_type='purchase_in')
    LIMIT 5
  `).catch(()=>[]);
  if (!jl.length) console.log('  لا توجد');
  else jl.forEach(j => console.log(`  ${j.description} | dr=${j.debit} cr=${j.credit}`));
}
main().catch(console.error);
