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
  // Delete empty duplicates
  const toDelete = [
    { table: 'financial_parties', id: 'eeaabf00-dc37-4273-9ed5-cc5059e72d63', name: 'يحيى صلاح (طرف مالي مكرر)' },
    { table: 'financial_parties', id: '62b6ce27-0666-49b5-a74d-d4610f9bf268', name: 'customer2026 (مكرر)' },
    { table: 'financial_parties', id: '0df465af-7293-4d6e-9607-cfd9a58de49f', name: 'عبدالحكيم رفيق (مكرر فارغ)' },
    { table: 'payroll_employees', id: 'cf4a365c-3f70-45ae-9ccb-34c7689d5556', name: 'يحيى صلاح (موظف مكرر)' },
  ];

  // Delete employee first (before party, since party might reference it)
  // Actually: delete party first since linked_entity_id references employee
  // Order: party eeaabf00 → employee cf4a365c → party 62b6ce27 → party 0df465af

  for (const item of toDelete) {
    try {
      await sql(`DELETE FROM public.${item.table} WHERE id='${item.id}'`);
      console.log(`✅ ${item.name} — تم الحذف`);
    } catch (e) {
      console.log(`❌ ${item.name} — فشل: ${e.message.slice(0, 100)}`);
    }
  }

  // Verify
  console.log('\n=== التحقق ===');
  const dupP = await sql(`
    SELECT name, party_type, count(*) as cnt
    FROM financial_parties GROUP BY name, party_type HAVING count(*) > 1
  `);
  console.log(`أطراف مكررة: ${dupP.length === 0 ? '0 ✅' : dupP.map(d=>`${d.name}(${d.cnt})`).join(', ')}`);

  const dupE = await sql(`
    SELECT full_name, count(*) as cnt
    FROM payroll_employees GROUP BY full_name HAVING count(*) > 1
  `);
  console.log(`موظفين مكررين: ${dupE.length === 0 ? '0 ✅' : dupE.map(d=>`${d.full_name}(${d.cnt})`).join(', ')}`);

  const totalP = await sql(`SELECT count(*) as cnt FROM financial_parties`);
  const totalE = await sql(`SELECT count(*) as cnt FROM payroll_employees`);
  console.log(`إجمالي أطراف: ${totalP[0].cnt} | إجمالي موظفين: ${totalE[0].cnt}`);
}
main().catch(console.error);
