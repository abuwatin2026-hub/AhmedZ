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
  const result = await sql(`
    WITH movements AS (
      SELECT 
        item_id,
        sum(CASE WHEN movement_type='purchase_in' THEN quantity ELSE 0 END) as purchased,
        sum(CASE WHEN movement_type='sale_out' THEN quantity ELSE 0 END) as sold,
        sum(CASE WHEN movement_type='return_in' THEN quantity ELSE 0 END) as returned,
        sum(CASE WHEN movement_type='adjust_in' THEN quantity ELSE 0 END) as adj_in,
        sum(CASE WHEN movement_type='adjust_out' THEN quantity ELSE 0 END) as adj_out,
        sum(CASE WHEN movement_type='transfer_in' THEN quantity ELSE 0 END) as trfin,
        sum(CASE WHEN movement_type='transfer_out' THEN quantity ELSE 0 END) as trfout
      FROM public.inventory_movements
      GROUP BY item_id
    ),
    stock AS (
      SELECT item_id, sum(available_quantity::numeric) as actual_stock
      FROM public.stock_management
      GROUP BY item_id
    ),
    items AS (
      SELECT id, name::text as item_name FROM public.menu_items
    )
    SELECT 
      i.item_name,
      m.purchased,
      m.sold,
      m.returned,
      m.adj_in,
      m.adj_out,
      m.trfin,
      m.trfout,
      (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out) AS expected_stock,
      s.actual_stock,
      (s.actual_stock - (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out)) AS discrepancy
    FROM movements m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN stock s ON s.item_id = m.item_id
    ORDER BY ABS(s.actual_stock - (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out)) DESC
  `);

  const errors = result.filter(r => Math.abs(parseFloat(r.discrepancy || 0)) > 0.5);
  const ok = result.filter(r => Math.abs(parseFloat(r.discrepancy || 0)) <= 0.5);

  console.log(`=== فحص جميع الأصناف ===`);
  console.log(`إجمالي الأصناف: ${result.length} | أصناف بفروق: ${errors.length} | أصناف صحيحة: ${ok.length}\n`);

  if (errors.length > 0) {
    console.log(`=== ⚠️ أصناف بها فروق في المخزون (${errors.length}) ===`);
    errors.forEach((r, i) => {
      const disc = parseFloat(r.discrepancy || 0);
      const sign = disc > 0 ? '↑ زيادة' : '↓ نقص';
      console.log(`${i+1}. ${r.item_name?.replace(/[{"}\\"]/g,'').slice(0,60)}`);
      console.log(`   مشتريات:${r.purchased} | مبيعات:${r.sold} | مرتجعات:${r.returned} | تعديل+:${r.adj_in} | تعديل-:${r.adj_out}`);
      console.log(`   متوقع:${r.expected_stock} | فعلي:${r.actual_stock} | فرق:${disc.toFixed(2)} (${sign})`);
    });
  } else {
    console.log('✅ لا توجد فروق في أي صنف!');
  }

  console.log(`\n=== ✅ أصناف الرصيد صحيح (${ok.length}) ===`);
  ok.forEach((r, i) => {
    console.log(`${i+1}. ${r.item_name?.replace(/[{"}\\"]/g,'').slice(0,60)} | فعلي:${r.actual_stock} | متوقع:${r.expected_stock}`);
  });
}
main().catch(console.error);
