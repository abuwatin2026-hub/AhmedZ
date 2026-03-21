const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const BASE = 'https://pmhivhtaoydfolseelyc.supabase.co';

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

// Login as the admin user and get JWT, then call the RPC via REST
async function loginAndCallRpc(returnId) {
  // Login
  const loginRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON },
    body: JSON.stringify({ email: 'admin@azta.com', password: '112233' })
  });
  const loginData = await loginRes.json();
  const jwt = loginData.access_token;
  if (!jwt) throw new Error('Login failed: ' + JSON.stringify(loginData).slice(0, 200));
  console.log('✅ Logged in as admin');
  
  // Call the RPC
  const rpcRes = await fetch(`${BASE}/rest/v1/rpc/process_sales_return`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON,
      'Authorization': `Bearer ${jwt}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ p_return_id: returnId })
  });
  
  const rpcData = await rpcRes.json();
  console.log('RPC status:', rpcRes.status);
  console.log('RPC response:', JSON.stringify(rpcData).slice(0, 500));
  return { status: rpcRes.status, data: rpcData };
}

async function main() {
  // Get the draft return we want to test
  const drafts = await sql(`SELECT id, order_id, refund_method, total_refund_amount FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 3`);
  console.log('Draft returns:');
  drafts.forEach(d => console.log(`  ${d.id} | order:${d.order_id.slice(-8)} | ${d.refund_method} | ${d.total_refund_amount}`));
  
  // Test the first one
  if (drafts.length === 0) { console.log('No draft returns'); return; }
  const retId = drafts[0].id;
  console.log(`\nTesting process_sales_return for return: ${retId}`);
  
  // Try calling as authenticated user
  try {
    const result = await loginAndCallRpc(retId);
    if (result.status === 200 || result.status === 204) {
      console.log('\n✅✅✅ SUCCESS! Return processed successfully!');
    } else {
      console.log('\n❌ FAILED with status:', result.status);
      console.log('Error details:', JSON.stringify(result.data));
    }
  } catch(e) {
    console.log('Error:', e.message);
  }
}
main().catch(console.error);
