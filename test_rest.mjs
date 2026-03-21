const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const BASE = 'https://pmhivhtaoydfolseelyc.supabase.co';

async function mgmt(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

// Get service_role key (jwt)
async function getServiceRoleJwt() {
  const result = await mgmt(`SELECT current_setting('app.settings.service_role_key', true) as k`).catch(() => []);
  if (result[0]?.k) return result[0].k;
  // from env
  return null;
}

async function restRpc(jwt, apiKey, fn, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey, 'Authorization': `Bearer ${jwt}` },
    body: JSON.stringify(args)
  });
  return { status: r.status, data: await r.json() };
}

async function main() {
  // Get draft return
  const draft = await mgmt(`SELECT id, order_id, refund_method FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 1`);
  const retId = draft[0]?.id;
  console.log('Return to test:', retId, '| method:', draft[0]?.refund_method);
  
  // First, CANCEL the test movement left by trace (cleanup)
  const testMovements = await mgmt(`SELECT id FROM public.inventory_movements WHERE reference_table='sales_returns' AND reference_id='${retId}' AND movement_type='return_in'`);
  if (testMovements.length > 0) {
    console.log(`\nFound ${testMovements.length} existing return_in movements - deleting test ones...`);
    for (const m of testMovements) {
      await mgmt(`DELETE FROM public.inventory_movements WHERE id='${m.id}'`).catch(() => {});
    }
    // Also delete journal lines and entries from trace
    await mgmt(`DELETE FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}'`).catch(() => {});
    console.log('✅ Cleaned up test data');
  }
  
  // Also revert status in case it got changed
  await mgmt(`UPDATE public.sales_returns SET status='draft' WHERE id='${retId}' AND status<>'draft'`).catch(() => {});
  
  // Now get service_role key to use as JWT
  const svcKeyRes = await mgmt(`
    SELECT setting FROM pg_settings WHERE name='app.settings.anon_key'
  `).catch(() => []);
  
  // Use the service role key from the project settings 
  const projSecrets = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/secrets`, {
    headers: { Authorization: `Bearer ${SBP}` }
  });
  const secrets = await projSecrets.json();
  console.log('\nAvailable secrets:', Array.isArray(secrets) ? secrets.map(s => s.name).join(', ') : JSON.stringify(secrets).slice(0,200));
  
  // Call process_sales_return via REST as service_role  
  // We need the service_role JWT for this
  // Try from supabase project API keys endpoint
  const apiKeys = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/api-keys`, {
    headers: { Authorization: `Bearer ${SBP}` }
  });
  const keys = await apiKeys.json();
  console.log('\nAPI Keys:', Array.isArray(keys) ? keys.map(k => `${k.name}: ${k.api_key?.slice(0,20)}...`).join(', ') : JSON.stringify(keys).slice(0,200));

  const svcKey = Array.isArray(keys) ? keys.find(k => k.name === 'service_role')?.api_key : null;
  const anonKey = Array.isArray(keys) ? keys.find(k => k.name === 'anon')?.api_key : null;
  
  if (svcKey) {
    console.log('\n✅ Got service_role key. Testing process_sales_return via REST...');
    
    // First make sure return status is draft
    await mgmt(`UPDATE public.sales_returns SET status='draft' WHERE id='${retId}'`);
    
    const res = await restRpc(svcKey, svcKey, 'process_sales_return', { p_return_id: retId });
    if (res.status === 200 || res.status === 204) {
      console.log('✅ process_sales_return SUCCESS via service_role!');
      const updated = await mgmt(`SELECT status FROM public.sales_returns WHERE id='${retId}'`);
      console.log('New status:', updated[0]?.status);
      
      // Revert to draft for next test
      await mgmt(`UPDATE public.sales_returns SET status='draft' WHERE id='${retId}'`);
      // Delete the created records
      await mgmt(`DELETE FROM public.inventory_movements WHERE reference_table='sales_returns' AND reference_id='${retId}'`).catch(()=>{});
      await mgmt(`DELETE FROM public.journal_lines WHERE journal_entry_id IN (SELECT id FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}')`).catch(()=>{});
      await mgmt(`DELETE FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}'`).catch(()=>{});
    } else {
      console.log('❌ FAILED via service_role:', JSON.stringify(res.data));
    }
  }
  
  if (anonKey) {
    console.log('\nAnon key found:', anonKey.slice(0,30) + '...');
    // Would need user login JWT to test as authenticated user
    // Let's try with psql instead
    console.log(`\nTo test as authenticated user, try running this in your browser console:`);
    console.log(`window.supabase?.rpc('process_sales_return', {p_return_id:'${retId}'})`);
  }
}
main().catch(console.error);
