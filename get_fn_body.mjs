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
const fs = await import('fs');
async function main() {
  const r = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='process_sales_return' AND pronamespace='public'::regnamespace LIMIT 1`);
  fs.writeFileSync('./process_sales_return_body.sql', r[0].def, 'utf8');
  console.log('Written to process_sales_return_body.sql, length:', r[0].def.length);
}
main().catch(console.error);
