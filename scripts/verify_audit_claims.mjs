/**
 * Verify audit claims against production - CORRECTED
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

  // ═══ TEST 1: exec_debug_sql ═══
  console.log('══ TEST 1: هل exec_debug_sql موجودة على الإنتاج؟ ══');
  try {
    const { data, error } = await sb.rpc('exec_debug_sql', { q: "SELECT json_build_object('alive', true) as result" });
    if (error) {
      if (error.code === '42883' || error.message?.includes('Could not find')) {
        console.log('✅ الدالة غير موجودة (آمن)');
      } else {
        console.log('⚠️  خطأ:', error.message, '| code:', error.code);
      }
    } else {
      console.log('🔴 مؤكد: الدالة موجودة وتعمل! نتيجة:', JSON.stringify(data));
    }
  } catch (e) { console.log('❌', e.message); }

  // ═══ TEST 2: طلبات مسلمة بدون صفوف دفع ═══
  console.log('\n══ TEST 2: طلبات مسلمة بدون صفوف دفع (آخر 90 يوم) ══');
  try {
    // Use exec_debug_sql since it exists!
    const { data } = await sb.rpc('exec_debug_sql', {
      q: `SELECT json_build_object(
        'total_delivered', (SELECT count(*) FROM orders WHERE status = 'delivered' AND created_at > now() - interval '90 days'),
        'missing_payments', (
          SELECT count(*) FROM orders o
          WHERE o.status = 'delivered'
            AND o.created_at > now() - interval '90 days'
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.reference_table = 'orders'
                AND p.reference_id = o.id::text
                AND p.direction = 'in'
            )
        )
      ) as result`
    });
    console.log('نتيجة:', JSON.stringify(data));
    if (data && typeof data === 'object') {
      const d = data;
      const total = d.total_delivered || 0;
      const missing = d.missing_payments || 0;
      if (missing > 0) {
        console.log(`🔴 مؤكد: ${missing} من ${total} طلب مسلم بدون صف دفع!`);
      } else {
        console.log(`✅ جميع الطلبات (${total}) لها صفوف دفع`);
      }
    }
  } catch (e) { console.log('❌', e.message); }

  // ═══ TEST 3: طلبات بدون حركات مخزون ═══
  console.log('\n══ TEST 3: طلبات مسلمة بدون حركات sale_out ══');
  try {
    const { data } = await sb.rpc('exec_debug_sql', {
      q: `SELECT json_build_object(
        'total_delivered', (SELECT count(*) FROM orders WHERE status = 'delivered' AND created_at > now() - interval '90 days'),
        'missing_sale_out', (
          SELECT count(*) FROM orders o
          WHERE o.status = 'delivered'
            AND o.created_at > now() - interval '90 days'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.reference_id = o.id::text
                AND m.movement_type = 'sale_out'
            )
        )
      ) as result`
    });
    console.log('نتيجة:', JSON.stringify(data));
    if (data && typeof data === 'object') {
      const d = data;
      const missing = d.missing_sale_out || 0;
      const total = d.total_delivered || 0;
      if (missing > 0) {
        console.log(`🔴 مؤكد: ${missing} من ${total} طلب مسلم بدون حركة sale_out!`);
      } else {
        console.log(`✅ جميع الطلبات (${total}) لها حركات مخزون`);
      }
    }
  } catch (e) { console.log('❌', e.message); }

  // ═══ TEST 4: paidAt but no payment row ═══
  console.log('\n══ TEST 4: طلبات paidAt≠null لكن بدون صف payment ══');
  try {
    const { data } = await sb.rpc('exec_debug_sql', {
      q: `SELECT json_build_object(
        'total_with_paidat', (
          SELECT count(*) FROM orders
          WHERE status = 'delivered'
            AND created_at > now() - interval '90 days'
            AND data->>'paidAt' IS NOT NULL
            AND data->>'paidAt' != ''
        ),
        'paidat_no_payment', (
          SELECT count(*) FROM orders o
          WHERE o.status = 'delivered'
            AND o.created_at > now() - interval '90 days'
            AND o.data->>'paidAt' IS NOT NULL
            AND o.data->>'paidAt' != ''
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.reference_table = 'orders'
                AND p.reference_id = o.id::text
                AND p.direction = 'in'
            )
        )
      ) as result`
    });
    console.log('نتيجة:', JSON.stringify(data));
    if (data && typeof data === 'object') {
      const d = data;
      const total = d.total_with_paidat || 0;
      const missing = d.paidat_no_payment || 0;
      if (missing > 0) {
        console.log(`🔴 مؤكد: ${missing} من ${total} طلب "مدفوع" بدون صف payment فعلي!`);
      } else {
        console.log(`✅ جميع الطلبات ذات paidAt (${total}) لها صفوف دفع`);
      }
    }
  } catch (e) { console.log('❌', e.message); }

  // ═══ TEST 5: Show some order examples ═══
  console.log('\n══ TEST 5: عينة من الطلبات الأخيرة ══');
  try {
    const { data } = await sb.rpc('exec_debug_sql', {
      q: `SELECT json_agg(row_to_json(t)) FROM (
        SELECT
          o.id::text as order_id,
          o.status,
          left(o.created_at::text, 10) as created,
          o.data->>'paidAt' as paid_at,
          o.data->>'paymentMethod' as method,
          (o.data->>'total')::numeric as total,
          (SELECT count(*) FROM payments p WHERE p.reference_table = 'orders' AND p.reference_id = o.id::text) as payment_rows,
          (SELECT count(*) FROM inventory_movements m WHERE m.reference_id = o.id::text AND m.movement_type = 'sale_out') as sale_out_rows
        FROM orders o
        WHERE o.status = 'delivered'
          AND o.created_at > now() - interval '30 days'
        ORDER BY o.created_at DESC
        LIMIT 10
      ) t`
    });
    if (Array.isArray(data)) {
      console.log('آخر 10 طلبات مسلمة (30 يوم):');
      console.log('ID       | الحالة   | التاريخ    | مدفوع      | طريقة | المبلغ    | صفوف_دفع | حركات_مخزون');
      console.log('---------|----------|------------|------------|-------|-----------|----------|------------');
      for (const r of data) {
        console.log(
          `${(r.order_id||'').slice(0,8)} | ${r.status||''} | ${r.created||''} | ${(r.paid_at||'—').slice(0,10)} | ${r.method||'—'} | ${r.total||0} | ${r.payment_rows||0} | ${r.sale_out_rows||0}`
        );
      }
    } else {
      console.log('نتيجة خام:', JSON.stringify(data));
    }
  } catch (e) { console.log('❌', e.message); }

  console.log('\n══ انتهاء التحقق ══');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
