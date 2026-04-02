const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}

async function main() {
  // Find online customers table
  const tables = await sql(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema='public' AND table_name ILIKE '%customer%'
    ORDER BY table_name
  `);
  console.log('Customer tables:', tables.map(t=>t.table_name).join(', '));

  // Check if there's an online_customers or customers table
  for (const t of tables) {
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='${t.table_name}' ORDER BY ordinal_position`);
    console.log(`\n${t.table_name} columns: ${cols.map(c=>c.column_name).join(', ')}`);
    
    const cnt = await sql(`SELECT count(*) as c FROM public."${t.table_name}"`);
    console.log(`  Count: ${cnt[0].c}`);
    
    const sample = await sql(`SELECT * FROM public."${t.table_name}" LIMIT 10`);
    sample.forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r).slice(0, 200)));
  }

  // Also check auth.users for customer-type accounts
  console.log('\n=== auth.users with customer role ===');
  const authUsers = await sql(`
    SELECT id, email, phone, raw_user_meta_data::text as meta, created_at
    FROM auth.users
    ORDER BY created_at DESC
    LIMIT 30
  `);
  authUsers.forEach(u => {
    const meta = u.meta?.slice(0, 150) || '';
    console.log(`  ${u.email || u.phone || '-'} | ${u.created_at} | ${meta}`);
  });

  // Check orders table for customer info
  console.log('\n=== Customers from orders ===');
  const orderCustomers = await sql(`
    SELECT DISTINCT 
      data->>'customer_name' as cname,
      data->>'customer_phone' as cphone,
      data->>'channel' as channel,
      count(*) as cnt
    FROM orders
    WHERE data->>'channel' = 'online' OR data->>'customer_name' IS NOT NULL
    GROUP BY cname, cphone, channel
    ORDER BY cnt DESC
  `).catch(()=>[]);
  orderCustomers.forEach(c => console.log(`  ${c.cname || '-'} | ${c.cphone || '-'} | channel=${c.channel} | ${c.cnt} orders`));

  // Check if there's a customers table directly
  const custTable = await sql(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema='public' AND (table_name='customers' OR table_name='online_customers')
  `);
  console.log('\nDirect customer tables:', custTable.map(t=>t.table_name).join(', ') || 'none');

  // Check customer_party_id in orders
  console.log('\n=== customer_party_id in orders ===');
  const cpCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name ILIKE '%customer%'`);
  console.log('Customer columns in orders:', cpCols.map(c=>c.column_name).join(', '));
}
main().catch(console.error);
