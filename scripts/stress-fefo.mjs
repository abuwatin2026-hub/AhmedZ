import { createClient } from '@supabase/supabase-js';

/**
 * ضغط FEFO للحجز/الخصم على الدُفعات
 * - يدعم سيناريوهات:
 *   1) reserve-only
 *   2) reserve-then-deduct
 *   3) mixed (حجز متداخل مع خصم متزامن)
 * - يُولّد تقرير: معدل النجاح/الفشل، متوسط زمن التنفيذ، حالات الانتظار، تحقق عدم حدوث Over-consumption
 *
 * تشغيل:
 *   node scripts/stress-fefo.mjs --concurrency=200 --scenario=reserve-only --runs=200
 */

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { concurrency: 100, scenario: 'reserve-only', runs: 100 };
  for (const a of args) {
    const [k, v] = a.split('=');
    if (k === '--concurrency') out.concurrency = Math.max(1, Number(v) || 100);
    if (k === '--scenario') out.scenario = String(v || 'reserve-only');
    if (k === '--runs') out.runs = Math.max(1, Number(v) || 100);
  }
  return out;
}

async function resolveWarehouseId() {
  // محاولة قراءة مستودع فعّال
  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('id, code, is_active')
      .eq('is_active', true)
      .order('code', { ascending: true })
      .limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    if (row?.id) return row.id;
  } catch {
    // تجاهل، قد لا يسمح RLS
  }
  // fallback غير مثالي: نفترض أن الدوال ستفشل إن لم نمرر warehouse_id؛ لذا سنطلب من المستخدم ضبطه يدويًا
  return process.env.WAREHOUSE_ID || null;
}

async function pickFoodItemWithBatches() {
  // اختيار صنف غذائي له 3–10 دفعات صالحة
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const { data: rows, error } = await supabase
    .from('batches')
    .select('item_id, expiry_date')
    .gte('expiry_date', today)
    .limit(1000);
  if (error) throw error;
  const counts = new Map();
  for (const r of rows || []) {
    counts.set(r.item_id, (counts.get(r.item_id) || 0) + 1);
  }
  const candidates = [...counts.entries()]
    .filter(([_, c]) => c >= 3 && c <= 10)
    .map(([item_id, c]) => ({ item_id, c }));
  if (candidates.length === 0) {
    // fallback: أي صنف له دفعة صالحة واحدة على الأقل
    const any = [...counts.entries()].map(([item_id, c]) => ({ item_id, c }));
    if (any.length === 0) throw new Error('لا توجد دفعات صالحة للاختبار.');
    return any[0].item_id;
  }
  return candidates[0].item_id;
}

async function createTestOrder() {
  const nowIso = new Date().toISOString();
  const payload = {
    status: 'pending',
    data: {
      id: 'client-temp',
      orderSource: 'online',
      items: [],
      subtotal: 0,
      total: 0,
      createdAt: nowIso
    }
  };
  const { data, error } = await supabase.from('orders').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

async function reserveOnce(itemId, qty, orderId, warehouseId) {
  const t0 = Date.now();
  try {
    const { error } = await supabase.rpc('reserve_stock_for_order', {
      p_items: [{ itemId, quantity: qty }],
      p_order_id: orderId,
      p_warehouse_id: warehouseId
    });
    const dt = Date.now() - t0;
    if (error) return { ok: false, dt, err: error.message || String(error) };
    return { ok: true, dt };
  } catch (e) {
    return { ok: false, dt: Date.now() - t0, err: String(e?.message || e) };
  }
}

async function deductOnce(itemId, qty, orderId, warehouseId) {
  const t0 = Date.now();
  try {
    const { error } = await supabase.rpc('deduct_stock_on_delivery_v2', {
      p_order_id: orderId,
      p_items: [{ itemId, quantity: qty }],
      p_warehouse_id: warehouseId
    });
    const dt = Date.now() - t0;
    if (error) return { ok: false, dt, err: error.message || String(error) };
    return { ok: true, dt };
  } catch (e) {
    return { ok: false, dt: Date.now() - t0, err: String(e?.message || e) };
  }
}

async function checkOverConsumption(itemId, warehouseId) {
  // تأكيد عدم وجود دفعات مستهلكة أكثر من المستلمة
  const { data, error } = await supabase
    .from('batches')
    .select('id, quantity_received, quantity_consumed')
    .eq('item_id', itemId)
    .eq('warehouse_id', warehouseId);
  if (error) return { ok: false, msg: error.message || String(error) };
  const bad = (data || []).filter(b => (Number(b.quantity_consumed) || 0) > (Number(b.quantity_received) || 0));
  return { ok: bad.length === 0, msg: bad.length === 0 ? 'OK' : `Detected ${bad.length} over-consumed batches` };
}

async function scenarioReserveOnly({ itemId, warehouseId, runs, concurrency }) {
  const qty = 1;
  const orderId = await createTestOrder();
  const tasks = Array.from({ length: runs }, () => () => reserveOnce(itemId, qty, orderId, warehouseId));
  return runConcurrent(tasks, concurrency);
}

async function scenarioReserveThenDeduct({ itemId, warehouseId, runs, concurrency }) {
  const qty = 1;
  const orderId = await createTestOrder();
  const tasks = Array.from({ length: runs }, () => async () => {
    const r = await reserveOnce(itemId, qty, orderId, warehouseId);
    if (!r.ok) return r;
    return await deductOnce(itemId, qty, orderId, warehouseId);
  });
  return runConcurrent(tasks, concurrency);
}

async function scenarioMixed({ itemId, warehouseId, runs, concurrency }) {
  const qty = 1;
  const orderId = await createTestOrder();
  const half = Math.ceil(runs / 2);
  const tasks = [
    ...Array.from({ length: half }, () => () => reserveOnce(itemId, qty, orderId, warehouseId)),
    ...Array.from({ length: runs - half }, () => () => deductOnce(itemId, qty, orderId, warehouseId))
  ];
  return runConcurrent(tasks, concurrency);
}

async function runConcurrent(taskFactories, concurrency) {
  const stats = {
    success: 0,
    fail: 0,
    durations: [],
    errors: [],
    longWaits: 0
  };
  const queue = [...taskFactories];
  const workers = Array.from({ length: concurrency }, () => (async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      const r = await task();
      stats.durations.push(r.dt);
      if (!r.ok) {
        stats.fail += 1;
        stats.errors.push(r.err);
      } else {
        stats.success += 1;
      }
      if (r.dt > 500) stats.longWaits += 1; // مؤشر انتظار/قفل تقريبي
    }
  })());
  await Promise.all(workers);
  return stats;
}

function summarize(title, stats) {
  const avg = stats.durations.length ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length : 0;
  const max = stats.durations.length ? Math.max(...stats.durations) : 0;
  const min = stats.durations.length ? Math.min(...stats.durations) : 0;
  console.log(`\n=== ${title} ===`);
  console.log(`Success: ${stats.success}`);
  console.log(`Fail: ${stats.fail}`);
  console.log(`Avg ms: ${avg.toFixed(2)} | Min: ${min} | Max: ${max}`);
  console.log(`Long waits (>500ms): ${stats.longWaits}`);
  if (stats.errors.length) {
    const buckets = {};
    for (const e of stats.errors) {
      const key = String(e || '').slice(0, 160);
      buckets[key] = (buckets[key] || 0) + 1;
    }
    console.log('Top Errors:');
    Object.entries(buckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([k, c]) => console.log(` - [${c}] ${k}`));
  }
}

async function main() {
  const { concurrency, scenario, runs } = parseArgs();
  console.log(`🚀 FEFO Stress | scenario=${scenario} | concurrency=${concurrency} | runs=${runs}`);
  const warehouseId = await resolveWarehouseId();
  if (!warehouseId) {
    console.error('❌ لم يتم تحديد warehouse_id. يرجى ضبط المتغير WAREHOUSE_ID أو تمكين القراءة من جدول warehouses.');
    process.exit(1);
  }
  const itemId = await pickFoodItemWithBatches();
  console.log(`Item under test: ${itemId} | Warehouse: ${warehouseId}`);

  let stats;
  if (scenario === 'reserve-only') {
    stats = await scenarioReserveOnly({ itemId, warehouseId, runs, concurrency });
    summarize('Reserve Only', stats);
  } else if (scenario === 'reserve-then-deduct') {
    stats = await scenarioReserveThenDeduct({ itemId, warehouseId, runs, concurrency });
    summarize('Reserve Then Deduct', stats);
  } else if (scenario === 'mixed') {
    stats = await scenarioMixed({ itemId, warehouseId, runs, concurrency });
    summarize('Mixed (Reserve/Deduct)', stats);
  } else {
    console.error('❌ سيناريو غير معروف. استخدم reserve-only أو reserve-then-deduct أو mixed.');
    process.exit(1);
  }

  const oc = await checkOverConsumption(itemId, warehouseId);
  console.log(`Over-consumption check: ${oc.ok ? 'OK' : 'FAILED'} (${oc.msg})`);

  // Invariants: call DB function for explicit checks
  try {
    const { data: inv, error: invErr } = await supabase.rpc('check_batch_invariants', {
      p_item_id: itemId,
      p_warehouse_id: warehouseId
    });
    if (invErr) {
      console.error('❌ Invariants RPC Failed:', invErr.message);
    } else {
      const ok = Boolean(inv?.ok);
      console.log('\n=== Invariants ===');
      console.log(`Result: ${ok ? 'OK' : 'FAIL'}`);
      const v = inv?.violations || {};
      console.log(`over_consumed: ${v.over_consumed ?? 0}`);
      console.log(`negative_remaining: ${v.negative_remaining ?? 0}`);
      console.log(`reserved_exceeds_remaining: ${v.reserved_exceeds_remaining ?? 0}`);
      console.log(`totals_exceed_received: ${v.totals_exceed_received ?? 0}`);
    }
  } catch (e) {
    console.error('❌ Invariants Check Error:', e?.message || e);
  }
  console.log('\n🎯 التقرير جاهز. استخدم سيناريوهات وحجوم مختلفة (100–500) وراجع المخرجات أعلاه.');
}

main().catch(e => {
  console.error('❌ خطأ أثناء التشغيل:', e?.message || e);
  process.exit(1);
});
