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

async function deleteParty(id, name) {
  // Delete FK children first
  const fks = await sql(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='financial_parties' AND tc.table_schema='public'
  `);
  for (const fk of fks) {
    await sql(`DELETE FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${id}'`).catch(()=>{});
  }
  await sql(`DELETE FROM financial_parties WHERE id='${id}'`);
  console.log(`  ✅ طرف مالي: ${name}`);
}

async function main() {
  // Test financial parties to delete
  const testPartyNames = [
    'Direct Test Employee',
    'Direct Test Employee 1772594535.007158',
    '25b65f34-ce92-421d-abbd-b53a0bfcf4f6',
    'zabon2026', 'zabon2027', 'zabon2028',
    'zabon2028customer2026', 'customer2026',
    'freshtest2026', 'newclient2026'
  ];

  // Test employees to delete
  const testEmpNames = [
    'Direct Test Employee',
    'Direct Test Employee 1772594535.007158'
  ];

  console.log('=== حذف الموظفين التجريبيين ===');
  for (const name of testEmpNames) {
    const emp = await sql(`SELECT id FROM payroll_employees WHERE full_name='${name}'`);
    for (const e of emp) {
      await sql(`DELETE FROM payroll_employees WHERE id='${e.id}'`);
      console.log(`  ✅ موظف: ${name}`);
    }
  }

  console.log('\n=== حذف الأطراف المالية التجريبية ===');
  for (const name of testPartyNames) {
    const parties = await sql(`SELECT id FROM financial_parties WHERE name='${name}'`);
    for (const p of parties) {
      await deleteParty(p.id, name);
    }
  }

  // Also delete related auth.users for zabon/test customers
  console.log('\n=== حذف حسابات auth المرتبطة ===');
  const testCustomers = await sql(`SELECT auth_user_id, full_name FROM customers WHERE full_name IN ('zabon2026','zabon2027','zabon2028','zabon2028customer2026','customer2026','freshtest2026','newclient2026')`);
  for (const c of testCustomers) {
    if (c.auth_user_id) {
      await sql(`DELETE FROM auth.identities WHERE user_id='${c.auth_user_id}'`).catch(()=>{});
      await sql(`DELETE FROM auth.sessions WHERE user_id='${c.auth_user_id}'`).catch(()=>{});
      await sql(`DELETE FROM auth.refresh_tokens WHERE user_id='${c.auth_user_id}'`).catch(()=>{});
      await sql(`DELETE FROM auth.users WHERE id='${c.auth_user_id}'`).catch(()=>{});
      console.log(`  ✅ auth: ${c.full_name}`);
    }
    // Delete from customers too
    await sql(`DELETE FROM customers WHERE auth_user_id='${c.auth_user_id}'`).catch(()=>{});
    console.log(`  ✅ customer: ${c.full_name}`);
  }

  // Verify
  console.log('\n=== التحقق ===');
  const remEmp = await sql(`SELECT count(*) as c FROM payroll_employees`);
  const remParty = await sql(`SELECT count(*) as c FROM financial_parties`);
  const remCust = await sql(`SELECT count(*) as c FROM customers`);
  console.log(`موظفين: ${remEmp[0].c}`);
  console.log(`أطراف مالية: ${remParty[0].c}`);
  console.log(`عملاء: ${remCust[0].c}`);
}
main().catch(console.error);
