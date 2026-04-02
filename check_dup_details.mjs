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

async function checkParty(id, name) {
  console.log(`\n--- ${name} (${id.slice(0,8)}) ---`);

  // party_ledger_entries
  const ple = await sql(`SELECT count(*) as cnt, coalesce(sum(amount),0) as total FROM party_ledger_entries WHERE party_id='${id}'`).catch(()=>[{cnt:0,total:0}]);
  console.log(`  دفتر الطرف: ${ple[0].cnt} قيد | إجمالي: ${ple[0].total}`);

  // party_open_items (debts)
  const poi = await sql(`SELECT count(*) as cnt, coalesce(sum(amount),0) as total FROM party_open_items WHERE party_id='${id}'`).catch(()=>[{cnt:0,total:0}]);
  console.log(`  بنود مفتوحة (ديون): ${poi[0].cnt} | إجمالي: ${poi[0].total}`);

  // ar_open_items
  const ar = await sql(`SELECT count(*) as cnt, coalesce(sum(amount),0) as total FROM ar_open_items WHERE party_id='${id}'`).catch(()=>[{cnt:0,total:0}]);
  console.log(`  ar_open_items: ${ar[0].cnt} | إجمالي: ${ar[0].total}`);

  // journal_lines referencing this party
  const jl = await sql(`SELECT count(*) as cnt FROM journal_lines WHERE party_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  قيود محاسبية: ${jl[0].cnt}`);

  // payments
  const pay = await sql(`SELECT count(*) as cnt, coalesce(sum(amount),0) as total FROM payments WHERE party_id='${id}'`).catch(()=>[{cnt:0,total:0}]);
  console.log(`  مدفوعات: ${pay[0].cnt} | إجمالي: ${pay[0].total}`);

  // orders linked
  const ord = await sql(`SELECT count(*) as cnt FROM orders WHERE customer_party_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  طلبات: ${ord[0].cnt}`);

  // purchase_receipts
  const pr = await sql(`SELECT count(*) as cnt FROM purchase_receipts WHERE supplier_party_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  فواتير شراء: ${pr[0].cnt}`);

  // credit limits
  const cl = await sql(`SELECT count(*) as cnt FROM party_credit_limits WHERE party_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  حدود ائتمان: ${cl[0].cnt}`);

  // created_at
  const info = await sql(`SELECT created_at, is_active FROM financial_parties WHERE id='${id}'`);
  console.log(`  تاريخ الإنشاء: ${info[0]?.created_at} | نشط: ${info[0]?.is_active}`);

  const hasData = parseInt(ple[0].cnt) > 0 || parseInt(poi[0].cnt) > 0 || parseInt(jl[0].cnt) > 0 || parseInt(pay[0].cnt) > 0 || parseInt(ord[0].cnt) > 0 || parseInt(pr[0].cnt) > 0;
  console.log(`  ← ${hasData ? '⚠️ عليه حركات!' : '✅ فارغ — يمكن حذفه'}`);
  return hasData;
}

async function checkEmployee(id, name) {
  console.log(`\n--- موظف: ${name} (${id.slice(0,8)}) ---`);
  
  const contracts = await sql(`SELECT count(*) as cnt FROM employee_contracts WHERE employee_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  عقود: ${contracts[0].cnt}`);
  
  const guarantees = await sql(`SELECT count(*) as cnt FROM employee_guarantees WHERE employee_id='${id}'`).catch(()=>[{cnt:0}]);
  console.log(`  ضمانات: ${guarantees[0].cnt}`);

  // Check if linked to financial_parties
  const fp = await sql(`SELECT id, name FROM financial_parties WHERE linked_entity_id='${id}'`).catch(()=>[]);
  console.log(`  أطراف مالية مرتبطة: ${fp.length}`);
  fp.forEach(f => console.log(`    → ${f.name} (${f.id.slice(0,8)})`));

  const info = await sql(`SELECT created_at, monthly_salary, employee_code FROM payroll_employees WHERE id='${id}'`);
  console.log(`  كود: ${info[0]?.employee_code || '-'} | راتب: ${info[0]?.monthly_salary} | إنشاء: ${info[0]?.created_at}`);

  const hasData = parseInt(contracts[0].cnt) > 0 || parseInt(guarantees[0].cnt) > 0 || fp.length > 0;
  console.log(`  ← ${hasData ? '⚠️ عليه بيانات!' : '✅ فارغ — يمكن حذفه'}`);
}

async function main() {
  // Duplicate parties
  const dups = [
    { name: 'يحيى صلاح', ids: ['66f035e0-d6ef-489b-8b53-caeee7cb18e0','eeaabf00-dc37-4273-9ed5-cc5059e72d63'] },
    { name: 'احمد محمد صالح زنقاح', ids: ['015be604-ab8e-4476-ac7e-63263d84fc01','ff705db6-607d-46ae-b46d-1fe2a65b9b3e'] },
    { name: 'customer2026', ids: ['536569dc-53e5-4579-a6e7-b83b282ff3e3','62b6ce27-0666-49b5-a74d-d4610f9bf268'] },
    { name: 'عبدالحكيم رفيق', ids: ['29c46e61-8730-4836-947f-ce0b3013403f','0df465af-7293-4d6e-9607-cfd9a58de49f'] },
  ];

  console.log('========= فحص الأطراف المالية المكررة =========');
  for (const dup of dups) {
    console.log(`\n======= ${dup.name} =======`);
    for (const id of dup.ids) {
      await checkParty(id, dup.name);
    }
  }

  // Duplicate employee
  console.log('\n\n========= فحص الموظفين المكررين =========');
  const empIds = ['fcb9af6f-b4cc-40b1-8ee3-c737e4962673','cf4a365c-3f70-45ae-9ccb-34c7689d5556'];
  for (const id of empIds) {
    await checkEmployee(id, 'يحيى صلاح');
  }
}
main().catch(console.error);
