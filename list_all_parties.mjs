const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main() {
  console.log('=== الموظفين (payroll_employees) ===');
  const emps = await sql(`SELECT id, full_name, employee_code, monthly_salary, created_at FROM payroll_employees ORDER BY created_at`);
  emps.forEach((e,i) => console.log(`  ${i+1}. ${e.full_name} | كود:${e.employee_code||'-'} | راتب:${e.monthly_salary} | ${e.created_at}`));

  console.log(`\n=== الأطراف المالية (${(await sql(`SELECT count(*) as c FROM financial_parties`))[0].c}) ===`);
  const parties = await sql(`
    SELECT fp.id, fp.name, fp.party_type, fp.is_active, fp.created_at,
      (SELECT count(*) FROM journal_lines jl WHERE jl.party_id=fp.id) as journal_cnt,
      (SELECT count(*) FROM orders o WHERE o.customer_party_id=fp.id) as order_cnt,
      (SELECT count(*) FROM party_ledger_entries ple WHERE ple.party_id=fp.id) as ledger_cnt
    FROM financial_parties fp
    ORDER BY fp.created_at
  `);
  parties.forEach((p,i) => {
    const hasData = parseInt(p.journal_cnt)>0 || parseInt(p.order_cnt)>0 || parseInt(p.ledger_cnt)>0;
    console.log(`  ${i+1}. ${p.name} | ${p.party_type} | ${p.is_active?'نشط':'غير نشط'} | قيود:${p.journal_cnt} طلبات:${p.order_cnt} دفتر:${p.ledger_cnt} | ${hasData?'⚠️ له حركات':'✅ فارغ'} | ${p.created_at}`);
  });
}
main().catch(console.error);
