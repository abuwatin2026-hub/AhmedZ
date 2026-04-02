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
  // List ALL customers with details
  console.log('=== customers ===');
  const custs = await sql(`SELECT * FROM customers ORDER BY created_at DESC`);
  custs.forEach(c => {
    console.log(`  ${c.id?.slice(0,8)} | ${c.full_name || c.name || '-'} | phone=${c.phone || '-'} | email=${c.email || '-'} | type=${c.customer_type || '-'} | created=${c.created_at}`);
  });

  console.log('\n=== customers_business ===');
  const biz = await sql(`SELECT * FROM customers_business ORDER BY created_at DESC`);
  biz.forEach(b => {
    console.log(`  ${b.id?.slice(0,8)} | ${b.business_name || b.name || '-'} | phone=${b.phone || '-'} | ${b.contact_person || '-'} | created=${b.created_at}`);
  });

  // Check which customers have orders
  console.log('\n=== عملاء لديهم طلبات ===');
  const custWithOrders = await sql(`
    SELECT customer_auth_user_id, customer_name, count(*) as cnt
    FROM orders
    WHERE customer_auth_user_id IS NOT NULL
    GROUP BY customer_auth_user_id, customer_name
    ORDER BY cnt DESC
  `);
  custWithOrders.forEach(c => console.log(`  ${c.customer_auth_user_id?.slice(0,8)} | ${c.customer_name || '-'} | ${c.cnt} طلبات`));

  // Check online_orders or order channel
  console.log('\n=== طلبات أونلاين ===');
  const onlineOrders = await sql(`
    SELECT id, order_number, customer_name, customer_auth_user_id, status, created_at
    FROM orders
    WHERE data->>'channel' = 'online' OR customer_auth_user_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 20
  `);
  onlineOrders.forEach(o => console.log(`  #${o.order_number} | ${o.customer_name || '-'} | auth=${o.customer_auth_user_id?.slice(0,8)||'-'} | status=${o.status} | ${o.created_at}`));

  // Auth users that are customers (not admin)
  console.log('\n=== auth.users (عملاء أونلاين) ===');
  const authCust = await sql(`
    SELECT id, email, phone, 
      raw_user_meta_data->>'full_name' as name,
      raw_user_meta_data->>'phone_number' as ph,
      raw_user_meta_data->>'role' as role,
      raw_user_meta_data->>'manual' as manual,
      created_at
    FROM auth.users
    WHERE raw_user_meta_data->>'role' = 'customer' 
      OR email LIKE '%@azta.com'
      OR raw_user_meta_data->>'manual' = 'true'
    ORDER BY created_at DESC
  `);
  console.log(`Found ${authCust.length} customer auth users:`);
  authCust.forEach(u => console.log(`  ${u.id?.slice(0,8)} | ${u.name || '-'} | ${u.email || u.phone || '-'} | role=${u.role||'-'} | manual=${u.manual||'-'} | ${u.created_at}`));
}
main().catch(console.error);
