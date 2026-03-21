const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

// Find ALL orders with inStoreFailureReason (any status)
const all = await sql(`
  SELECT RIGHT(o.id::text, 6) as sid, o.status, o.data->>'inStoreFailureReason' as reason
  FROM public.orders o
  WHERE o.data->>'inStoreFailureReason' IS NOT NULL AND o.data->>'inStoreFailureReason' <> ''
`);
console.log('Orders still with error messages:', all.length);
all.forEach(o => console.log(`  #${o.sid} | ${o.status} | ${o.reason?.substring(0,60)}`));

// Clear ALL remaining ones
if (all.length > 0) {
  await sql(`
    do $$
    begin
      alter table public.orders disable trigger user;
      UPDATE public.orders
      SET data = (data - 'inStoreFailureReason' - 'inStoreFailureAt'),
          updated_at = now()
      WHERE data->>'inStoreFailureReason' IS NOT NULL
        AND data->>'inStoreFailureReason' <> '';
      alter table public.orders enable trigger user;
    end;
    $$;
  `);
  console.log('✅ Cleared all remaining error messages');
}

// Verify
const remaining = await sql(`
  SELECT COUNT(*) as cnt FROM public.orders
  WHERE data->>'inStoreFailureReason' IS NOT NULL AND data->>'inStoreFailureReason' <> ''
`);
console.log(`\nRemaining: ${remaining[0].cnt} ${remaining[0].cnt == 0 ? '✅' : '⚠️'}`);
