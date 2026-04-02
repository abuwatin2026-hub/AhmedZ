/**
 * BACKFILL sale_out — handles FOOD_SALE_REQUIRES_BATCH by finding nearest batch
 * Non-food items: batch_id = null (allowed)
 * Food items: find best matching batch by FEFO or most recent
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Cache
const itemCategoryCache = {};
const itemBatchCache = {};

async function getItemCategory(itemId) {
  if (itemCategoryCache[itemId] !== undefined) return itemCategoryCache[itemId];
  const { data } = await sb.from('menu_items').select('category').eq('id', itemId).limit(1);
  const cat = data?.[0]?.category || 'non-food';
  itemCategoryCache[itemId] = cat;
  return cat;
}

async function getBestBatch(itemId, deliveredAt) {
  if (itemBatchCache[itemId]) return itemBatchCache[itemId];
  // Try to find batch that was active at delivery time (FEFO order, not expired at that date)
  const deliveryDate = deliveredAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  
  // Try 1: batch not expired at delivery time, ordered by expiry ASC (FEFO)
  let { data: batches } = await sb
    .from('batches')
    .select('id, expiry_date, quantity_received, quantity_consumed, status')
    .eq('item_id', itemId)
    .neq('status', 'inactive')
    .order('expiry_date', { ascending: true });

  if (!batches || batches.length === 0) {
    // Try 2: any batch including inactive
    const { data: anyBatch } = await sb
      .from('batches')
      .select('id, expiry_date, quantity_received, quantity_consumed')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(1);
    batches = anyBatch || [];
  }

  if (batches.length === 0) return null;

  // Prefer batch that was not expired at delivery time
  const notExpired = batches.find(b => !b.expiry_date || b.expiry_date >= deliveryDate);
  const best = notExpired || batches[0]; // fallback to first

  itemBatchCache[itemId] = best.id;
  return best.id;
}

async function main() {
  const { data: { user }, error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log(`✅ Auth OK — ${user.id.slice(0, 8)}\n`);

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: allOrders } = await sb
    .from('orders').select('id, status, created_at, data')
    .eq('status', 'delivered').gte('created_at', since)
    .order('created_at', { ascending: true });

  const { data: existingSaleOuts } = await sb
    .from('inventory_movements').select('reference_id')
    .eq('movement_type', 'sale_out').gte('created_at', since);

  const existingRefs = new Set((existingSaleOuts || []).map(m => m.reference_id));
  const missingOrders = (allOrders || []).filter(o => !existingRefs.has(o.id));

  console.log(`تحتاج backfill: ${missingOrders.length}\n`);

  // Load avg_cost
  const allItemIds = [...new Set(missingOrders.flatMap(o => (o.data?.items || []).map(it => it.id).filter(Boolean)))];
  const stockByItemId = {};
  for (let i = 0; i < allItemIds.length; i += 50) {
    const { data: stocks } = await sb.from('stock_management').select('item_id, avg_cost').in('item_id', allItemIds.slice(i, i + 50));
    for (const s of (stocks || [])) stockByItemId[s.item_id] = Number(s.avg_cost || 0);
  }

  let inserted = 0, skipped = 0, errors = 0;
  const errorDetails = [];

  for (const order of missingOrders) {
    const d = order.data || {};
    const items = Array.isArray(d.items) ? d.items : [];
    const warehouseId = d.warehouseId || null;
    const deliveredAt = d.deliveredAt || order.created_at;
    const orderId = order.id;

    if (items.length === 0) { skipped++; continue; }

    // Guard: skip if already has movements
    const { data: already } = await sb.from('inventory_movements')
      .select('id').eq('movement_type', 'sale_out').eq('reference_id', orderId).limit(1);
    if (already && already.length > 0) { skipped++; continue; }

    // Build one movement per item
    let orderOk = true;
    for (const item of items) {
      const itemId = item.id;
      if (!itemId) continue;
      const qty = Number(item.quantity || item.qty || 0);
      if (qty <= 0) continue;

      const unitCost = Number(item.costPrice || item.cost_price || stockByItemId[itemId] || 0);
      const totalCost = qty * unitCost;

      // Check if food → need batch
      const category = await getItemCategory(itemId);
      const isFood = category === 'food';
      let batchId = null;

      if (isFood) {
        batchId = await getBestBatch(itemId, deliveredAt);
        if (!batchId) {
          console.log(`    ⚠️ ${orderId.slice(0,8)} صنف ${itemId.slice(0,8)} (food) — لا يوجد batch، سيُتخطى`);
          continue; // skip this item, don't block whole order
        }
      }

      const { error: insErr } = await sb.from('inventory_movements').insert({
        item_id: itemId,
        movement_type: 'sale_out',
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        reference_table: 'orders',
        reference_id: orderId,
        warehouse_id: warehouseId,
        batch_id: batchId,
        occurred_at: deliveredAt,
        data: {
          backfill: true,
          backfill_reason: 'missing_sale_out_audit_trail',
          backfill_at: new Date().toISOString(),
          item_category: category,
          payment_method: d.paymentMethod || null,
        },
      });

      if (insErr) {
        const msg = (insErr.message || '').slice(0, 120);
        console.log(`    ❌ ${orderId.slice(0,8)} item:${itemId.slice(0,8)} [${category}]: ${msg}`);
        orderOk = false;
        errorDetails.push({ orderId: orderId.slice(0,8), itemId: itemId.slice(0,8), error: msg });
      }
      await sleep(30);
    }

    if (orderOk) {
      inserted++;
      console.log(`  ✅ ${orderId.slice(0,8)} (${(order.created_at||'').slice(0,10)}) — ${items.length} صنف | ${d.paymentMethod || '?'}`);
    } else {
      errors++;
    }
    await sleep(50);
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`تم: ${inserted} | تخطي: ${skipped} | أخطاء: ${errors}`);
  console.log('═══════════════════════════════════════');

  if (errorDetails.length > 0) {
    console.log('\nالأخطاء:');
    for (const e of errorDetails.slice(0, 20)) console.log(`  ${e.orderId} / ${e.itemId}: ${e.error}`);
  }

  // Final count
  const { data: finalMovs } = await sb.from('inventory_movements')
    .select('reference_id').eq('movement_type', 'sale_out').gte('created_at', since);
  const finalRefs = new Set((finalMovs || []).map(m => m.reference_id));
  const stillMissing = (allOrders || []).filter(o => !finalRefs.has(o.id)).length;
  console.log(`\nلا تزال بدون أي sale_out: ${stillMissing}`);
  if (stillMissing === 0) console.log('✅ اكتمل الإصلاح!');

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
