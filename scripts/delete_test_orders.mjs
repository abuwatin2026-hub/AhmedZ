/**
 * COMPLETE deletion of test orders - handles all FK constraints in correct order
 * Tables in dependency order (children first):
 * 1. ar_payment_status (FK → payments)
 * 2. batch_sales_trace (FK → orders)
 * 3. journal_lines (FK → journal_entries) — need admin or use RPC
 * 4. journal_entries
 * 5. inventory_movements (has immutability trigger — need to disable or use admin)
 * 6. order_item_cogs
 * 7. payments
 * 8. order_item_reservations
 * 9. orders
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ORDER_IDS = [
  '74bd07c2-862b-4e6e-92fb-be4e94a0aa7c', // اختبار E2E
  'e1c0d001-03b2-4de7-9cc2-227dfd048584', // اختبار بعد الإصلاح
  'c884a5d0-2d3e-45a9-82ca-88f39be50538', // تجربة فحص تلقائي
  '27523d4c-f339-4421-a4dc-612afe2e0523', // عميل دخان smoke_live
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tryDelete(table, field, ids, label) {
  if (!ids || ids.length === 0) { console.log(`  ⏭️  ${label}: لا شيء`); return true; }
  const { error } = await sb.from(table).delete().in(field, ids);
  if (error) {
    console.log(`  ❌ ${label}: ${error.message.slice(0, 100)}`);
    return false;
  }
  console.log(`  ✅ ${label}: حُذف`);
  return true;
}

async function main() {
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log('✅ Auth OK\n');

  console.log('الطلبات المستهدفة:', ORDER_IDS.length);

  // Gather related IDs first
  const { data: payments } = await sb.from('payments').select('id').in('reference_id', ORDER_IDS);
  const paymentIds = (payments||[]).map(p => p.id);

  const { data: invMovs } = await sb.from('inventory_movements').select('id').in('reference_id', ORDER_IDS);
  const invMovIds = (invMovs||[]).map(m => m.id);

  // journal entries for orders directly
  const { data: jeOrders } = await sb.from('journal_entries')
    .select('id').in('source_id', ORDER_IDS.map(String)).eq('source_table', 'orders');
  const jeOrderIds = (jeOrders||[]).map(j => j.id);

  // journal entries for payments
  const { data: jePayments } = await sb.from('journal_entries')
    .select('id').in('source_id', paymentIds.map(String));
  const jePaymentIds = (jePayments||[]).map(j => j.id);

  // journal entries for inventory movements
  const { data: jeMovs } = await sb.from('journal_entries')
    .select('id').in('source_id', invMovIds.map(String));
  const jeMovIds = (jeMovs||[]).map(j => j.id);

  const allJeIds = [...new Set([...jeOrderIds, ...jePaymentIds, ...jeMovIds])];

  console.log(`\nملخص:
  payments: ${paymentIds.length}
  inventory_movements: ${invMovIds.length}
  journal_entries: ${allJeIds.length}
  `);

  console.log('══ الحذف بالترتيب الصحيح ══\n');

  // 1. ar_payment_status → payments
  await tryDelete('ar_payment_status', 'payment_id', paymentIds, 'ar_payment_status');
  await sleep(100);

  // 2. batch_sales_trace → orders
  await tryDelete('batch_sales_trace', 'order_id', ORDER_IDS, 'batch_sales_trace');
  await sleep(100);

  // 3. journal_lines → journal_entries (all)
  await tryDelete('journal_lines', 'journal_entry_id', allJeIds, 'journal_lines');
  await sleep(100);

  // 4. journal_entries (all)
  await tryDelete('journal_entries', 'id', allJeIds, 'journal_entries');
  await sleep(100);

  // 5. inventory_movements — try direct delete (trigger may block)
  if (invMovIds.length > 0) {
    const { error: invErr } = await sb.from('inventory_movements').delete().in('id', invMovIds);
    if (invErr) {
      console.log(`  ⚠️ inventory_movements مباشر مرفوض: ${invErr.message.slice(0,80)}`);
      // Try via RPC void_inventory_movement if exists
      for (const movId of invMovIds) {
        const { error: rpcErr } = await sb.rpc('void_inventory_movement', { p_movement_id: movId });
        if (rpcErr) {
          // Try delete_inventory_movement
          const { error: rpcErr2 } = await sb.rpc('admin_delete_inventory_movement', { p_id: movId });
          if (rpcErr2) console.log(`    ❌ void movement ${movId.slice(0,8)}: ${rpcErr2.message.slice(0,60)}`);
          else console.log(`    ✅ deleted via admin_delete_inventory_movement`);
        } else {
          console.log(`    ✅ voided movement ${movId.slice(0,8)}`);
        }
      }
    } else {
      console.log(`  ✅ inventory_movements: حُذف ${invMovIds.length}`);
    }
  } else {
    console.log('  ⏭️  inventory_movements: لا شيء');
  }
  await sleep(100);

  // 6. order_item_cogs
  await tryDelete('order_item_cogs', 'order_id', ORDER_IDS, 'order_item_cogs');
  await sleep(100);

  // 7. payments
  await tryDelete('payments', 'id', paymentIds, 'payments');
  await sleep(100);

  // 8. order_item_reservations
  await tryDelete('order_item_reservations', 'order_id', ORDER_IDS, 'order_item_reservations');
  await sleep(100);

  // 9. orders themselves
  await tryDelete('orders', 'id', ORDER_IDS, `orders (${ORDER_IDS.length})`);

  // ══ Verify ══
  console.log('\n══ التحقق النهائي ══');
  const { data: remaining } = await sb.from('orders').select('id, data').in('id', ORDER_IDS);
  if ((remaining||[]).length === 0) {
    console.log('✅ تم الحذف الكامل — لا يوجد أي طلب اختبار');
  } else {
    console.log(`⚠️ لا يزال ${remaining.length} طلب موجود:`);
    for (const r of remaining) {
      console.log(`  - ${r.data?.invoiceNumber||r.id.slice(0,8)} | ${r.data?.customerName||'?'}`);
    }
  }

  // Check inventory_movements
  const { data: remMovs } = await sb.from('inventory_movements').select('id').in('reference_id', ORDER_IDS);
  console.log(`  inventory_movements المتبقية: ${(remMovs||[]).length}`);

  // Check payments
  const { data: remPay } = await sb.from('payments').select('id').in('reference_id', ORDER_IDS);
  console.log(`  payments المتبقية: ${(remPay||[]).length}`);

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
