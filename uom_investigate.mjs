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
  // === STEP 0: Understand how quantities are stored ===
  console.log('===== STEP 0: Schema & UOM Investigation =====\n');

  // What columns does inventory_movements have related to UOM?
  const imCols = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='inventory_movements' ORDER BY ordinal_position`);
  console.log('inventory_movements columns:');
  console.log(imCols.map(c => `  ${c.column_name} (${c.data_type})`).join('\n'));

  // Check if there's uom-related columns
  const uomCols = imCols.filter(c => c.column_name.match(/uom|unit|factor|base/i));
  console.log('\nUOM-related columns:', uomCols.map(c=>c.column_name).join(', '));

  // === STEP 1: Sample data from a SURPLUS item (شوفان كويكر) to see qty vs uom ===
  console.log('\n===== STEP 1: Sample — شوفان كويكر (surplus +5084) =====');
  const kId = (await sql(`SELECT id FROM menu_items WHERE name::text ILIKE '%كويكر%' LIMIT 1`))[0].id;
  
  // UOM units
  const uoms = await sql(`
    SELECT u.uom_id, u.qty_in_base, u.is_default_purchase, u.is_default_sales,
      (SELECT um.name::text FROM uom um WHERE um.id = u.uom_id) as uom_name
    FROM item_uom_units u WHERE u.item_id='${kId}'
  `).catch(()=>[]);
  console.log('\nUOM units:');
  uoms.forEach(u => console.log(`  ${u.uom_name} | qty_in_base=${u.qty_in_base} | purchase=${u.is_default_purchase} | sales=${u.is_default_sales}`));

  // All purchase_in movements with ALL columns
  const purchMvs = await sql(`
    SELECT quantity, uom_name, uom_factor, uom_qty_in_base, base_quantity, data,
      created_at::date as dt
    FROM inventory_movements 
    WHERE item_id='${kId}' AND movement_type='purchase_in'
    ORDER BY created_at
  `).catch(async () => {
    // Try without uom columns
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='inventory_movements' AND (column_name ILIKE '%uom%' OR column_name ILIKE '%base%' OR column_name ILIKE '%factor%')`);
    console.log('Available UOM cols in inv_movements:', cols.map(c=>c.column_name).join(', '));
    return [];
  });
  console.log('\nPurchase movements:');
  purchMvs.forEach(p => console.log(`  ${p.dt} | qty=${p.quantity} | uom=${p.uom_name||'-'} | factor=${p.uom_factor||'-'} | base_qty=${p.base_quantity||'-'} | uom_qty_base=${p.uom_qty_in_base||'-'}`));

  // Purchase receipt items
  const pris = await sql(`
    SELECT pri.quantity, pri.uom_id, pri.qty_base,
      (SELECT um.name::text FROM uom um WHERE um.id = pri.uom_id) as uom_name
    FROM purchase_receipt_items pri WHERE pri.item_id='${kId}'
    ORDER BY pri.created_at
  `);
  console.log('\nPurchase receipt items:');
  pris.forEach(p => console.log(`  qty=${p.quantity} | uom=${p.uom_name||'-'} | qty_base=${p.qty_base}`));

  // Stock management
  const sm = await sql(`SELECT available_quantity, unit, warehouse_id FROM stock_management WHERE item_id='${kId}'`);
  console.log('\nStock management:');
  sm.forEach(s => console.log(`  available=${s.available_quantity} | unit=${s.unit} | warehouse=${s.warehouse_id?.slice(0,8)}`));

  // sale_out movements
  const saleMvs = await sql(`
    SELECT quantity, created_at::date as dt
    FROM inventory_movements 
    WHERE item_id='${kId}' AND movement_type='sale_out'
  `);
  console.log('\nSale movements:');
  saleMvs.forEach(s => console.log(`  ${s.dt} | qty=${s.quantity}`));

  // === STEP 2: Same for عصير ميرا وسط (surplus +1070) ===
  console.log('\n===== STEP 2: Sample — عصير ميرا وسط (surplus +1070) =====');
  const mId = (await sql(`SELECT id FROM menu_items WHERE name::text ILIKE '%ميرا وسط%' LIMIT 1`))[0].id;
  
  const mUoms = await sql(`
    SELECT u.qty_in_base, u.is_default_purchase, u.is_default_sales,
      (SELECT um.name::text FROM uom um WHERE um.id = u.uom_id) as uom_name
    FROM item_uom_units u WHERE u.item_id='${mId}'
  `).catch(()=>[]);
  console.log('\nUOM units:');
  mUoms.forEach(u => console.log(`  ${u.uom_name} | qty_in_base=${u.qty_in_base} | purchase=${u.is_default_purchase} | sales=${u.is_default_sales}`));

  const mPris = await sql(`
    SELECT pri.quantity, pri.qty_base,
      (SELECT um.name::text FROM uom um WHERE um.id = pri.uom_id) as uom_name
    FROM purchase_receipt_items pri WHERE pri.item_id='${mId}'
  `);
  console.log('\nPurchase receipt items:');
  mPris.forEach(p => console.log(`  qty=${p.quantity} | uom=${p.uom_name} | qty_base=${p.qty_base}`));

  const mMvs = await sql(`
    SELECT movement_type, quantity, created_at::date as dt
    FROM inventory_movements WHERE item_id='${mId}' ORDER BY created_at
  `);
  console.log('\nAll movements:');
  mMvs.forEach(m => console.log(`  ${m.dt} | ${m.movement_type} | qty=${m.quantity}`));

  const mSm = await sql(`SELECT available_quantity, unit FROM stock_management WHERE item_id='${mId}'`);
  console.log('\nStock: ' + mSm.map(s=>`available=${s.available_quantity} unit=${s.unit}`).join(', '));

  // === STEP 3: Check if inventory_movements.quantity is already in base unit ===
  console.log('\n===== STEP 3: Is inventory_movements.quantity in base unit? =====');
  // Compare purchase_in qty with purchase_receipt qty_base for same item
  const comparison = await sql(`
    SELECT 
      im.quantity as movement_qty,
      pri.quantity as receipt_qty,
      pri.qty_base as receipt_base_qty,
      im.item_id
    FROM inventory_movements im
    JOIN purchase_receipt_items pri ON pri.item_id = im.item_id 
      AND pri.receipt_id::text = im.reference_id
    WHERE im.movement_type = 'purchase_in'
    LIMIT 10
  `).catch(async () => {
    console.log('Direct join failed, trying manual comparison...');
    // Manual comparison for كويكر
    return [];
  });
  console.log('\nMovement qty vs Receipt base qty:');
  comparison.forEach(c => console.log(`  movement=${c.movement_qty} receipt=${c.receipt_qty} base=${c.receipt_base_qty} match=${c.movement_qty == c.receipt_base_qty ? 'BASE ✅' : c.movement_qty == c.receipt_qty ? 'RECEIPT_QTY' : 'DIFFERENT ⚠️'}`));
}
main().catch(console.error);
