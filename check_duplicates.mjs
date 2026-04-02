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
  // 1. Duplicate financial parties (same name)
  console.log('=== أطراف مالية مكررة (نفس الاسم) ===');
  const dupParties = await sql(`
    SELECT name, party_type, count(*) as cnt, array_agg(id::text) as ids
    FROM financial_parties
    GROUP BY name, party_type
    HAVING count(*) > 1
    ORDER BY cnt DESC
  `);
  if (dupParties.length === 0) {
    console.log('  ✅ لا يوجد أطراف مكررة');
  } else {
    dupParties.forEach(d => console.log(`  ⚠️ "${d.name}" (${d.party_type}): ${d.cnt} مرات | IDs: ${d.ids}`));
  }

  // 2. Duplicate employees (payroll_employees)
  console.log('\n=== موظفين مكررين (نفس الاسم) ===');
  const dupEmps = await sql(`
    SELECT full_name, count(*) as cnt, array_agg(id::text) as ids
    FROM payroll_employees
    GROUP BY full_name
    HAVING count(*) > 1
    ORDER BY cnt DESC
  `);
  if (dupEmps.length === 0) {
    console.log('  ✅ لا يوجد موظفين مكررين');
  } else {
    dupEmps.forEach(d => console.log(`  ⚠️ "${d.full_name}": ${d.cnt} مرات | IDs: ${d.ids}`));
  }

  // 3. Duplicate contracts
  console.log('\n=== عقود مكررة (نفس الموظف ونفس نوع العقد) ===');
  const dupContracts = await sql(`
    SELECT ec.employee_id, pe.full_name, ec.contract_type, count(*) as cnt, array_agg(ec.id::text) as ids
    FROM employee_contracts ec
    LEFT JOIN payroll_employees pe ON pe.id = ec.employee_id
    GROUP BY ec.employee_id, pe.full_name, ec.contract_type
    HAVING count(*) > 1
    ORDER BY cnt DESC
  `);
  if (dupContracts.length === 0) {
    console.log('  ✅ لا يوجد عقود مكررة');
  } else {
    dupContracts.forEach(d => console.log(`  ⚠️ "${d.full_name}" (${d.contract_type}): ${d.cnt} عقود | IDs: ${d.ids}`));
  }

  // 4. Duplicate guarantees
  console.log('\n=== ضمانات مكررة (نفس الموظف والكفيل) ===');
  const dupGuarantees = await sql(`
    SELECT eg.employee_id, pe.full_name, eg.guarantor_name, count(*) as cnt, array_agg(eg.id::text) as ids
    FROM employee_guarantees eg
    LEFT JOIN payroll_employees pe ON pe.id = eg.employee_id
    GROUP BY eg.employee_id, pe.full_name, eg.guarantor_name
    HAVING count(*) > 1
    ORDER BY cnt DESC
  `);
  if (dupGuarantees.length === 0) {
    console.log('  ✅ لا يوجد ضمانات مكررة');
  } else {
    dupGuarantees.forEach(d => console.log(`  ⚠️ "${d.full_name}" كفيل:"${d.guarantor_name}": ${d.cnt} مرات | IDs: ${d.ids}`));
  }

  // Summary
  const totalParties = await sql(`SELECT count(*) as cnt FROM financial_parties`);
  const totalEmps = await sql(`SELECT count(*) as cnt FROM payroll_employees`);
  const totalContracts = await sql(`SELECT count(*) as cnt FROM employee_contracts`);
  const totalGuarantees = await sql(`SELECT count(*) as cnt FROM employee_guarantees`);
  
  console.log('\n=== الإحصائيات ===');
  console.log(`  أطراف مالية: ${totalParties[0].cnt} (مكرر: ${dupParties.length})`);
  console.log(`  موظفين: ${totalEmps[0].cnt} (مكرر: ${dupEmps.length})`);
  console.log(`  عقود: ${totalContracts[0].cnt} (مكرر: ${dupContracts.length})`);
  console.log(`  ضمانات: ${totalGuarantees[0].cnt} (مكرر: ${dupGuarantees.length})`);
}
main().catch(console.error);
