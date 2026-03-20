const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  return r.json();
}
async function main() {
  const r1 = await sql(
    "SELECT proname, pronargs FROM pg_proc WHERE proname LIKE '%in_store%' OR proname LIKE '%create_sale%' OR proname LIKE '%instore%' OR proname LIKE '%invoice_now%' OR proname LIKE '%credit_limit%' OR proname LIKE '%purge_candidate%' ORDER BY proname"
  );
  console.log('Related functions:');
  r1.forEach(f => console.log(' ', f.proname, `(${f.pronargs} args)`));

  const r2 = await sql(
    "SELECT o.id, o.status, o.data->>'total' as total, o.data->>'customerName' as customer, p.amount, p.method, p.occurred_at FROM public.orders o JOIN public.payments p ON p.reference_id = o.id::text AND p.direction = 'in' WHERE o.status = 'cancelled' ORDER BY p.occurred_at DESC LIMIT 10"
  );
  console.log('\nCancelled with payments:');
  r2.forEach(r => console.log('  ', r.id.slice(-6), '|', r.customer, '|', r.total, '| paid:', r.amount, r.method, '|', r.occurred_at?.slice(0,10)));

  const r3 = await sql("SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename");
  console.log('\nRealtime tables currently:', r3.map(t => t.tablename).join(', ') || '(none)');
}
main().catch(console.error);
