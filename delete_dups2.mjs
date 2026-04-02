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
  const toDelete = [
    'eeaabf00-dc37-4273-9ed5-cc5059e72d63', // يحيى صلاح
    '62b6ce27-0666-49b5-a74d-d4610f9bf268', // customer2026
    '0df465af-7293-4d6e-9607-cfd9a58de49f', // عبدالحكيم رفيق
  ];

  // Find ALL FK constraints referencing financial_parties
  const fks = await sql(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='financial_parties' AND tc.table_schema='public'
  `);
  console.log('FK references to financial_parties:');
  fks.forEach(f => console.log(`  ${f.table_name}.${f.column_name}`));

  for (const id of toDelete) {
    console.log(`\nDeleting ${id.slice(0,8)}...`);
    // Check and delete child records from FK tables
    for (const fk of fks) {
      const cnt = await sql(`SELECT count(*) as c FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${id}'`).catch(()=>[{c:'0'}]);
      if (cnt[0].c !== '0') {
        console.log(`  Deleting ${cnt[0].c} from ${fk.table_name}`);
        await sql(`DELETE FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${id}'`).catch(e => console.log(`    err: ${e.message.slice(0,80)}`));
      }
    }
    // Now delete the party
    await sql(`DELETE FROM public.financial_parties WHERE id='${id}'`);
    console.log(`  ✅ Deleted`);
  }

  // Verify
  console.log('\n=== التحقق ===');
  const dupP = await sql(`SELECT name, count(*) as cnt FROM financial_parties GROUP BY name HAVING count(*) > 1`);
  console.log(`أطراف مكررة: ${dupP.length === 0 ? '0 ✅' : dupP.map(d=>`${d.name}(${d.cnt})`).join(', ')}`);
  const total = await sql(`SELECT count(*) as cnt FROM financial_parties`);
  console.log(`إجمالي أطراف: ${total[0].cnt}`);
}
main().catch(console.error);
