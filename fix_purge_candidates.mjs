const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 300));
  return b;
}

// SQL function - using column alias instead of named column in TABLE definition
const CREATE_FN = `
CREATE OR REPLACE FUNCTION public.get_auto_purge_candidates(p_limit integer DEFAULT 50)
RETURNS TABLE(
  order_id       uuid,
  order_total    numeric,
  paid_amount    numeric,
  diff           numeric,
  customer_name  text,
  payment_method text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    o.id                                                   AS order_id,
    COALESCE(o.total, 0)                                   AS order_total,
    COALESCE(SUM(p.amount), 0)                             AS paid_amount,
    ABS(COALESCE(o.total,0) - COALESCE(SUM(p.amount),0))  AS diff,
    o.customer_name                                         AS customer_name,
    o.payment_method                                        AS payment_method,
    o.created_at                                            AS created_at
  FROM public.orders o
  LEFT JOIN public.payments p
    ON p.reference_id = o.id::text AND p.direction = 'in'
  WHERE o.status = 'delivered'
  GROUP BY o.id, o.total, o.customer_name, o.payment_method, o.created_at
  HAVING ABS(COALESCE(o.total,0) - COALESCE(SUM(p.amount),0)) > 1
  ORDER BY ABS(COALESCE(o.total,0) - COALESCE(SUM(p.amount),0)) DESC
  LIMIT p_limit;
$fn$
`;

async function main() {
  console.log('Creating get_auto_purge_candidates...');
  await sql(CREATE_FN);
  console.log('✅ Function created');
  
  await sql('GRANT EXECUTE ON FUNCTION public.get_auto_purge_candidates(integer) TO authenticated');
  console.log('✅ GRANT applied');
  
  // Verify all functions now exist
  const fns = await sql("SELECT proname FROM pg_proc WHERE proname IN ('issue_invoice_now','get_credit_limit_summary','get_auto_purge_candidates') AND pronamespace='public'::regnamespace ORDER BY proname");
  console.log('All 3 functions:', fns.map(f=>f.proname).join(', '));
  
  // Final Realtime check
  const rt = await sql("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename");
  console.log('Realtime tables:', rt.map(t=>t.tablename).join(', '));

  // Run get_auto_purge_candidates to make sure it works
  const cands = await sql('SELECT * FROM public.get_auto_purge_candidates(10)');
  console.log(`Auto purge candidates: ${cands.length} طلب يحتاج مراجعة`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
