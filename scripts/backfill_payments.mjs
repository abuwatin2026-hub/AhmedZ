/**
 * Backfill missing payment rows using record_order_payment_v2 RPC
 * This RPC handles shift assignment internally
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log('✅ Auth OK\n');

  // Get all delivered orders missing payments
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error: oErr } = await sb
    .from('orders')
    .select('id, status, created_at, data')
    .eq('status', 'delivered')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (oErr) { console.error('Error fetching orders:', oErr.message); process.exit(1); }
  console.log(`إجمالي الطلبات المسلمة: ${orders.length}`);

  // Check which ones are missing payments
  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of orders) {
    // Check if payment already exists
    const { data: existing } = await sb
      .from('payments')
      .select('id')
      .eq('reference_table', 'orders')
      .eq('reference_id', order.id)
      .eq('direction', 'in')
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const d = order.data || {};
    const total = Number(d.total) || 0;
    if (total <= 0) {
      console.log(`  ⏭️ ${order.id.slice(0,8)} — total=0, تخطي`);
      skipped++;
      continue;
    }

    const method = (d.paymentMethod || 'cash').trim();
    const currency = (d.currency || 'SAR').toUpperCase();
    const occurredAt = d.paidAt || d.deliveredAt || order.created_at;
    const breakdown = Array.isArray(d.paymentBreakdown) ? d.paymentBreakdown : [];

    // Use breakdown if available, otherwise single payment
    const linesToRecord = breakdown.length > 0
      ? breakdown.filter(p => (Number(p.amount) || 0) > 0).map((p, i) => ({
          method: (p.method || method).trim(),
          amount: Number(p.amount),
          idx: i,
        }))
      : [{ method, amount: total, idx: 0 }];

    let allOk = true;
    for (const line of linesToRecord) {
      const idempotencyKey = `backfill:${order.id}:${line.idx}:${line.method}:${line.amount}`;

      const { error: rpcErr } = await sb.rpc('record_order_payment_v2', {
        p_order_id: order.id,
        p_amount: line.amount,
        p_method: line.method,
        p_occurred_at: occurredAt,
        p_idempotency_key: idempotencyKey,
        p_currency: currency,
        p_data: {
          backfill: true,
          backfill_reason: 'missing_payment_row',
          backfill_at: new Date().toISOString(),
        },
      });

      if (rpcErr) {
        // Try without currency if it fails
        const { error: rpcErr2 } = await sb.rpc('record_order_payment_v2', {
          p_order_id: order.id,
          p_amount: line.amount,
          p_method: line.method,
          p_occurred_at: occurredAt,
          p_idempotency_key: idempotencyKey,
          p_currency: currency,
          p_data: { backfill: true },
        });

        if (rpcErr2) {
          const msg = rpcErr2.message || '';
          // Idempotency conflict means it already exists — that's OK
          if (msg.includes('duplicate') || msg.includes('conflict') || msg.includes('already')) {
            continue;
          }
          console.log(`  ❌ ${order.id.slice(0,8)} [${line.method}/${line.amount}]: ${msg}`);
          allOk = false;
        }
      }
    }

    if (allOk) {
      fixed++;
      console.log(`  ✅ ${order.id.slice(0,8)} — ${method} ${total} ${currency}`);
    } else {
      errors++;
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`تم إصلاح: ${fixed} | تخطي: ${skipped} | أخطاء: ${errors}`);
  console.log(`═══════════════════════════════════════`);

  // Final verification
  console.log('\n📊 التحقق النهائي...');
  const { data: finalOrders } = await sb
    .from('orders')
    .select('id')
    .eq('status', 'delivered')
    .gte('created_at', since);

  let stillMissing = 0;
  for (const o of (finalOrders || [])) {
    const { data: p } = await sb
      .from('payments')
      .select('id')
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id)
      .eq('direction', 'in')
      .limit(1);
    if (!p || p.length === 0) stillMissing++;
  }

  console.log(`الطلبات المسلمة: ${(finalOrders||[]).length}`);
  console.log(`لا تزال بدون دفع: ${stillMissing}`);
  if (stillMissing === 0) {
    console.log('✅ جميع الطلبات لها صفوف دفع الآن!');
  } else {
    console.log(`⚠️  لا يزال ${stillMissing} طلب بدون صف دفع`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
