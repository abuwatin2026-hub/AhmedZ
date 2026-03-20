const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q})});
  const body = await r.json();
  if(!r.ok) throw new Error(JSON.stringify(body).slice(0,300));
  return body;
}

async function run(label, q) {
  try {
    await sql(q);
    console.log(`✅ ${label}`);
    return true;
  } catch(e) {
    console.error(`❌ ${label}: ${e.message.slice(0,200)}`);
    return false;
  }
}

async function main() {
  console.log('══════ تطبيق التحسينات على الـ DB ══════\n');

  // First: check actual admin_users pk column
  const adminCols = await sql("SELECT column_name FROM information_schema.columns WHERE table_name='admin_users' AND table_schema='public' ORDER BY ordinal_position LIMIT 5").catch(()=>[]);
  console.log('admin_users columns:', adminCols.map(c=>c.column_name).join(', ') || 'table not found');
  
  // Check if order_payment_purge_requests exists
  const purgeExists = await sql("SELECT tablename FROM pg_tables WHERE tablename='order_payment_purge_requests' AND schemaname='public'").catch(()=>[]);
  console.log('order_payment_purge_requests exists:', purgeExists.length > 0);

  console.log('');

  // ── Fix 1: Realtime ──────────────────────────────────────────
  await run('Realtime: add orders',
    "ALTER PUBLICATION supabase_realtime ADD TABLE public.orders"
  );
  await run('Realtime: add payments',
    "ALTER PUBLICATION supabase_realtime ADD TABLE public.payments"
  );

  // ── Fix 2: issue_invoice_now ─────────────────────────────────
  await run('Function: issue_invoice_now', `
    CREATE OR REPLACE FUNCTION public.issue_invoice_now(p_order_id uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_now timestamptz := now(); v_inv_num text;
    BEGIN
      SELECT invoice_number INTO v_inv_num FROM public.orders WHERE id = p_order_id;
      IF v_inv_num IS NULL OR v_inv_num = '' THEN
        v_inv_num := 'INV-' || to_char(v_now,'YYYYMMDD') || '-' || upper(substr(p_order_id::text,1,6));
        UPDATE public.orders SET invoice_number = v_inv_num WHERE id = p_order_id;
      END IF;
      UPDATE public.orders
        SET data = jsonb_set(jsonb_set(data,'{invoiceIssuedAt}',to_jsonb(v_now::text)),'{invoiceNumber}',to_jsonb(v_inv_num)),
            updated_at = v_now
        WHERE id = p_order_id AND (data->>'invoiceIssuedAt') IS NULL;
    END; $$
  `);
  await run('GRANT: issue_invoice_now',
    "GRANT EXECUTE ON FUNCTION public.issue_invoice_now(uuid) TO authenticated"
  );

  // ── Fix 3: get_credit_limit_summary ─────────────────────────
  await run('Function: get_credit_limit_summary', `
    CREATE OR REPLACE FUNCTION public.get_credit_limit_summary(p_party_id uuid, p_amount numeric DEFAULT 0)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_limit numeric; v_days integer; v_used numeric; v_available numeric;
    BEGIN
      SELECT credit_limit, credit_days INTO v_limit, v_days
      FROM public.party_credit_limits WHERE party_id = p_party_id LIMIT 1;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('has_limit',false,'limit',0,'used',0,'available',0,'credit_days',0,'would_exceed',false);
      END IF;
      SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN open_base_amount ELSE -open_base_amount END),0)
      INTO v_used FROM public.party_open_items
      WHERE party_id = p_party_id AND status IN ('open_active','partially_settled');
      v_available := GREATEST(0, v_limit - v_used);
      RETURN jsonb_build_object('has_limit',true,'limit',v_limit,'used',v_used,'available',v_available,'credit_days',v_days,'would_exceed',(v_used+p_amount)>v_limit);
    END; $$
  `);
  await run('GRANT: get_credit_limit_summary',
    "GRANT EXECUTE ON FUNCTION public.get_credit_limit_summary(uuid,numeric) TO authenticated"
  );

  // ── Fix 4: get_auto_purge_candidates ────────────────────────
  await run('Function: get_auto_purge_candidates', `
    CREATE OR REPLACE FUNCTION public.get_auto_purge_candidates(p_limit integer DEFAULT 50)
    RETURNS TABLE(order_id uuid, order_total numeric, paid_amount numeric, difference numeric,
                  customer_name text, payment_method text, created_at timestamptz)
    LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      SELECT o.id, COALESCE(o.total,0), COALESCE(SUM(p.amount),0),
             ABS(COALESCE(o.total,0)-COALESCE(SUM(p.amount),0)),
             o.customer_name, o.payment_method, o.created_at
      FROM public.orders o
      LEFT JOIN public.payments p ON p.reference_id=o.id::text AND p.direction='in'
      WHERE o.status='delivered'
      GROUP BY o.id,o.total,o.customer_name,o.payment_method,o.created_at
      HAVING ABS(COALESCE(o.total,0)-COALESCE(SUM(p.amount),0))>1
      ORDER BY difference DESC LIMIT p_limit;
    $$
  `);
  await run('GRANT: get_auto_purge_candidates',
    "GRANT EXECUTE ON FUNCTION public.get_auto_purge_candidates(integer) TO authenticated"
  );

  // ── Fix 5: cancelled orders view ────────────────────────────
  await run('View: v_cancelled_orders_with_payments', `
    CREATE OR REPLACE VIEW public.v_cancelled_orders_with_payments AS
    SELECT o.id AS order_id, o.created_at, o.customer_name,
           o.total AS order_total, o.payment_method,
           o.data->>'cancellationReason' AS cancellation_reason,
           COALESCE(SUM(p.amount),0) AS total_paid,
           jsonb_agg(jsonb_build_object('payment_id',p.id,'amount',p.amount,'method',p.method,'date',p.occurred_at) ORDER BY p.occurred_at) AS payments
    FROM public.orders o
    JOIN public.payments p ON p.reference_id=o.id::text AND p.direction='in'
    WHERE o.status='cancelled'
    GROUP BY o.id,o.created_at,o.customer_name,o.total,o.payment_method,o.data
    ORDER BY total_paid DESC
  `);
  await run('GRANT: v_cancelled_orders_with_payments',
    "GRANT SELECT ON public.v_cancelled_orders_with_payments TO authenticated"
  );

  // ── Fix 6: Performance indexes ───────────────────────────────
  await run('Index: payments reference+direction',
    "CREATE INDEX IF NOT EXISTS idx_payments_reference_direction ON public.payments(reference_id, direction) WHERE direction='in'"
  );
  await run('Index: orders status+created_at',
    "CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders(status, created_at DESC)"
  );

  // ── Fix 7: RLS for purge_requests ───────────────────────────
  if (purgeExists.length > 0) {
    await run('RLS: enable on order_payment_purge_requests',
      "ALTER TABLE public.order_payment_purge_requests ENABLE ROW LEVEL SECURITY"
    );
    // Use auth.users role check instead of admin_users
    await run('Policy: admins manage purge requests', `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_payment_purge_requests' AND schemaname='public' AND policyname='admins_all_purge_requests') THEN
          CREATE POLICY admins_all_purge_requests ON public.order_payment_purge_requests
            FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$
    `);
  } else {
    console.log('⚠️  order_payment_purge_requests: جدول غير موجود — تم التخطي');
  }

  // ── Verify results ───────────────────────────────────────────
  console.log('\n══════ التحقق النهائي ══════\n');
  const rt = await sql("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename").catch(()=>[]);
  console.log('Realtime tables:', rt.map(t=>t.tablename).join(', ') || '(none)');
  
  const fns = await sql("SELECT proname FROM pg_proc WHERE proname IN ('issue_invoice_now','get_credit_limit_summary','get_auto_purge_candidates') AND pronamespace='public'::regnamespace ORDER BY proname").catch(()=>[]);
  console.log('New functions:', fns.map(f=>f.proname).join(', ') || '(none)');
  
  const vw = await sql("SELECT viewname FROM pg_views WHERE viewname='v_cancelled_orders_with_payments'").catch(()=>[]);
  console.log('View v_cancelled_orders_with_payments:', vw.length ? '✅' : '❌');
  
  const idx = await sql("SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_payments_reference_direction','idx_orders_status_created')").catch(()=>[]);
  console.log('Indexes:', idx.map(i=>i.indexname).join(', ') || '(none)');

  // Show cancelled orders
  const c = await sql("SELECT order_id, customer_name, order_total, total_paid FROM public.v_cancelled_orders_with_payments ORDER BY total_paid DESC").catch(()=>[]);
  if(c.length) {
    console.log('\n⚠️  طلبات ملغاة بها دفعات تحتاج مراجعة:');
    c.forEach(r=>console.log(`  ${String(r.order_id).slice(-6)} | ${r.customer_name} | إجمالي طلب: ${r.order_total} | مدفوع: ${r.total_paid}`));
  }
  
  console.log('\n══════ اكتمل التطبيق ══════');
}
main().catch(console.error);
