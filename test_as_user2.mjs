const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const BASE = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

async function main() {
  // Step 1: Login
  const loginRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON },
    body: JSON.stringify({ email: 'admin@azta.com', password: '112233' })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.log('Login failed:', JSON.stringify(loginData).slice(0,200));
    return;
  }
  const jwt = loginData.access_token;
  console.log('✅ Login OK. Role:', loginData.user?.role, '| RoleInToken: checking...');
  
  // Step 2: Get the draft return to test
  const drafts = await sql(`SELECT id, order_id, refund_method FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 1`);
  const retId = drafts[0]?.id;
  console.log('Testing return:', retId, '| method:', drafts[0]?.refund_method);
  
  // Step 3: Call process_sales_return as authenticated user
  const rpcRes = await fetch(`${BASE}/rest/v1/rpc/process_sales_return`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON,
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify({ p_return_id: retId })
  });
  const rpcData = await rpcRes.json();
  console.log('\nRPC status:', rpcRes.status);
  if (rpcRes.status === 200 || rpcRes.status === 204) {
    console.log('✅✅✅ SUCCESS! Return processed!');
    const updated = await sql(`SELECT status FROM public.sales_returns WHERE id='${retId}'`);
    console.log('Return new status:', updated[0]?.status);
  } else {
    console.log('❌ FAILED:', JSON.stringify(rpcData));
  }
  
  // Step 4: If failed - also call the debug function
  if (!(rpcRes.status === 200 || rpcRes.status === 204)) {
    const debugRes = await fetch(`${BASE}/rest/v1/rpc/debug_process_return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ p_return_id: retId })
    });
    const debugData = await debugRes.json();
    console.log('\ndebug_process_return result:');
    console.log(JSON.stringify(debugData));
  }
}
main().catch(console.error);
