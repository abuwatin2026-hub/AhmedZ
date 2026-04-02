/**
 * === إصلاح شامل لنظام البيع الحضوري ===
 * 
 * المرحلة 1: Backfill صفوف الدفع المفقودة
 * المرحلة 2: حذف exec_debug_sql ودوال debug
 * 
 * ⚠️ هذا السكربت يعدّل بيانات الإنتاج - read-write
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function execSql(q) {
  const { data, error } = await sb.rpc('exec_debug_sql', { q });
  if (error) throw new Error(`SQL Error: ${error.message} | code: ${error.code}`);
  return data;
}

async function main() {
  // Auth
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log('✅ Auth OK\n');

  // ══════════════════════════════════════════════
  // المرحلة 1: Backfill صفوف الدفع المفقودة
  // ══════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════');
  console.log('المرحلة 1: إنشاء صفوف الدفع المفقودة');
  console.log('═══════════════════════════════════════════════');

  try {
    const backfillPaymentsSQL = `
      DO $$
      DECLARE
        rec RECORD;
        v_count int := 0;
        v_total numeric;
        v_method text;
        v_currency text;
        v_occurred_at timestamptz;
        v_breakdown jsonb;
        v_entry jsonb;
        v_amount numeric;
        v_idx int;
      BEGIN
        FOR rec IN
          SELECT o.id, o.status, o.created_at, o.data
          FROM orders o
          WHERE o.status = 'delivered'
            AND o.created_at > now() - interval '90 days'
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.reference_table = 'orders'
                AND p.reference_id = o.id::text
                AND p.direction = 'in'
            )
        LOOP
          v_total := COALESCE((rec.data->>'total')::numeric, 0);
          v_method := COALESCE(NULLIF(TRIM(rec.data->>'paymentMethod'), ''), 'cash');
          v_currency := COALESCE(NULLIF(TRIM(rec.data->>'currency'), ''), 'SAR');
          v_occurred_at := COALESCE(
            (rec.data->>'paidAt')::timestamptz,
            (rec.data->>'deliveredAt')::timestamptz,
            rec.created_at
          );

          IF v_total <= 0 THEN
            CONTINUE;
          END IF;

          -- Check if there's a paymentBreakdown
          v_breakdown := rec.data->'paymentBreakdown';

          IF v_breakdown IS NOT NULL AND jsonb_array_length(v_breakdown) > 0 THEN
            -- Insert from breakdown
            v_idx := 0;
            FOR v_entry IN SELECT * FROM jsonb_array_elements(v_breakdown)
            LOOP
              v_amount := COALESCE((v_entry->>'amount')::numeric, 0);
              IF v_amount <= 0 THEN CONTINUE; END IF;

              INSERT INTO payments (
                direction, method, amount, currency,
                reference_table, reference_id,
                occurred_at, data
              ) VALUES (
                'in',
                COALESCE(NULLIF(TRIM(v_entry->>'method'), ''), v_method),
                v_amount,
                v_currency,
                'orders',
                rec.id::text,
                v_occurred_at,
                jsonb_build_object(
                  'orderId', rec.id::text,
                  'backfill', true,
                  'backfill_reason', 'missing_payment_row',
                  'backfill_at', now()::text,
                  'breakdownIndex', v_idx
                )
              );
              v_idx := v_idx + 1;
            END LOOP;
          ELSE
            -- Single payment from order total
            INSERT INTO payments (
              direction, method, amount, currency,
              reference_table, reference_id,
              occurred_at, data
            ) VALUES (
              'in',
              v_method,
              v_total,
              v_currency,
              'orders',
              rec.id::text,
              v_occurred_at,
              jsonb_build_object(
                'orderId', rec.id::text,
                'backfill', true,
                'backfill_reason', 'missing_payment_row',
                'backfill_at', now()::text
              )
            );
          END IF;

          v_count := v_count + 1;
        END LOOP;

        RAISE NOTICE 'Backfilled payments for % orders', v_count;
      END $$;
      SELECT json_build_object('status', 'done') as result;
    `;
    const result = await execSql(backfillPaymentsSQL);
    console.log('✅ نتيجة backfill الدفعات:', JSON.stringify(result));
  } catch (e) {
    console.error('❌ فشل backfill الدفعات:', e.message);
  }

  // Verify
  console.log('\n📊 التحقق بعد Backfill الدفعات...');
  try {
    const verify = await execSql(`
      SELECT json_build_object(
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
        ),
        'backfilled_count', (
          SELECT count(*) FROM payments
          WHERE data->>'backfill' = 'true'
            AND data->>'backfill_reason' = 'missing_payment_row'
        )
      ) as result
    `);
    console.log('نتيجة التحقق:', JSON.stringify(verify));
  } catch (e) {
    console.error('❌ فشل التحقق:', e.message);
  }

  // ══════════════════════════════════════════════
  // المرحلة 2: حذف دوال Debug من الإنتاج
  // ══════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════');
  console.log('المرحلة 2: حذف دوال Debug/Diag من الإنتاج');
  console.log('═══════════════════════════════════════════════');

  try {
    // First get list of debug functions
    const debugFunctions = await execSql(`
      SELECT json_agg(p.proname) FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND (
          p.proname LIKE 'debug_%'
          OR p.proname LIKE 'diag_%'
          OR p.proname = 'exec_debug_sql'
          OR p.proname LIKE 'test_rpc_%'
          OR p.proname = 'query_rpc'
          OR p.proname LIKE 'check_deployed_%'
          OR p.proname LIKE 'simulate_%'
        )
    `);
    console.log('دوال debug/diag الموجودة:', JSON.stringify(debugFunctions));

    // Drop them one by one using DO block
    const dropSQL = `
      DO $$
      DECLARE
        func_rec RECORD;
        drop_cmd TEXT;
        dropped INT := 0;
      BEGIN
        FOR func_rec IN
          SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public'
            AND (
              p.proname LIKE 'debug_%'
              OR p.proname LIKE 'diag_%'
              OR p.proname LIKE 'test_rpc_%'
              OR p.proname = 'query_rpc'
              OR p.proname LIKE 'check_deployed_%'
              OR p.proname LIKE 'simulate_%'
            )
        LOOP
          drop_cmd := format('DROP FUNCTION IF EXISTS public.%I(%s)', func_rec.proname, func_rec.args);
          EXECUTE drop_cmd;
          dropped := dropped + 1;
          RAISE NOTICE 'Dropped: %(%)', func_rec.proname, func_rec.args;
        END LOOP;
        RAISE NOTICE 'Total dropped: %', dropped;
      END $$;
      SELECT json_build_object('status', 'debug_functions_dropped') as result;
    `;
    const dropResult = await execSql(dropSQL);
    console.log('✅ حذف دوال debug:', JSON.stringify(dropResult));

    // Now drop exec_debug_sql LAST (it drops itself!)
    console.log('\n🔴 حذف exec_debug_sql (آخر خطوة)...');
    const dropExecSQL = `
      DO $$
      BEGIN
        DROP FUNCTION IF EXISTS public.exec_debug_sql(text);
        DROP FUNCTION IF EXISTS public.exec_debug_sql(text, text);
        RAISE NOTICE 'exec_debug_sql DROPPED';
      END $$;
      SELECT json_build_object('status', 'exec_debug_sql_dropped') as result;
    `;
    const dropExecResult = await execSql(dropExecSQL);
    console.log('✅ exec_debug_sql:', JSON.stringify(dropExecResult));

  } catch (e) {
    console.error('❌ خطأ في حذف دوال debug:', e.message);
  }

  // Verify exec_debug_sql is gone
  console.log('\n📊 التحقق من حذف exec_debug_sql...');
  try {
    const { data, error } = await sb.rpc('exec_debug_sql', { q: "SELECT 1" });
    if (error) {
      if (error.code === '42883' || error.message?.includes('Could not find')) {
        console.log('✅ exec_debug_sql محذوفة بنجاح!');
      } else {
        console.log('⚠️  خطأ مختلف:', error.message);
      }
    } else {
      console.log('🔴 exec_debug_sql لا تزال موجودة! النتيجة:', JSON.stringify(data));
    }
  } catch (e) {
    console.log('✅ exec_debug_sql محذوفة (استثناء):', e.message);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('انتهاء عمليات الإصلاح');
  console.log('═══════════════════════════════════════════════');

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
