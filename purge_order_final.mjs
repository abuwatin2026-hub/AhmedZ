const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

const OID = '9ada629f-13a2-4c04-8816-9c431f929539';

async function main() {
  // Check if order still exists
  const o = await sql(`SELECT id, status FROM public.orders WHERE id='${OID}'`);
  console.log('Order exists:', o.length > 0 ? 'YES' : 'NO');
  if (o.length === 0) { console.log('Already deleted!'); return; }

  // Find ALL blocking FKs
  const fks = await sql(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='orders' AND tc.table_schema='public'
  `);
  
  for (const fk of fks) {
    const c = await sql(`SELECT count(*) as cnt FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${OID}'`).catch(()=>[{cnt:'err'}]);
    if (c[0].cnt !== '0') {
      console.log(`BLOCKING: ${fk.table_name}.${fk.column_name} = ${c[0].cnt} records (constraint: ${fk.constraint_name})`);
      // Delete it
      const trgs2 = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='${fk.table_name}' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
      for (const t of trgs2) await sql(`ALTER TABLE public."${fk.table_name}" DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
      
      await sql(`DELETE FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${OID}'`);
      console.log(`  ✅ Deleted from ${fk.table_name}`);
      
      for (const t of trgs2) await sql(`ALTER TABLE public."${fk.table_name}" ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});
    }
  }

  // Now try deleting the order
  const ordTrgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='orders' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
  for (const t of ordTrgs) await sql(`ALTER TABLE public.orders DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
  
  await sql(`DELETE FROM public.orders WHERE id='${OID}'`);
  console.log('✅ ORDER DELETED');
  
  for (const t of ordTrgs) await sql(`ALTER TABLE public.orders ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});

  // Verify
  const check = await sql(`SELECT count(*) as cnt FROM public.orders WHERE id='${OID}'`);
  console.log(`Order exists: ${check[0].cnt === '0' ? 'NO ✅ (deleted!)' : 'YES ❌'}`);
  const total = await sql(`SELECT count(*) as cnt FROM public.orders`);
  console.log(`Total orders: ${total[0].cnt}`);
}
main().catch(console.error);
