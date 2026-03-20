// Create storage bucket and deploy second migration
const SBP_TOKEN = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzkzNzE4MDQsImV4cCI6MjA1NDk0NzgwNH0.VyFvFKTtP1O1iy7FpZ3b4Ke-vVMK1RBDIZkbbbI7zSI';
const fs = await import('fs');

async function mgmtAPI(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP_TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://api.supabase.com/v1${path}`, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0,500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function runSQL(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP_TOKEN}` },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`${r.status} ${t.slice(0,500)}`); }
  return r.json();
}

async function main() {
  // 1. Create storage bucket 'documents'
  console.log('1. Creating storage bucket "documents"...');
  try {
    const result = await mgmtAPI('/projects/pmhivhtaoydfolseelyc/storage/buckets', 'POST', {
      id: 'documents',
      name: 'documents',
      public: true,
      file_size_limit: 10485760, // 10MB
      allowed_mime_types: ['image/jpeg','image/png','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    });
    console.log('✅ Bucket created:', JSON.stringify(result));
  } catch(e) {
    if (e.message.includes('already exists') || e.message.includes('409') || e.message.includes('Duplicate')) {
      console.log('ℹ️ Bucket already exists — OK');
    } else {
      console.log('⚠️ Bucket creation:', e.message);
    }
  }

  // 2. Deploy migration 20260321010000
  console.log('\n2. Deploying migration 20260321010000_voucher_excellence.sql...');
  try {
    const sql = fs.readFileSync('./supabase/migrations/20260321010000_voucher_excellence.sql', 'utf8');
    await runSQL(sql);
    console.log('✅ Migration deployed successfully');
  } catch(e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  }

  // 3. Verify new RPC exists
  console.log('\n3. Verifying update_manual_voucher_draft RPC...');
  const check = await runSQL(`SELECT proname FROM pg_proc WHERE proname = 'update_manual_voucher_draft' AND pronamespace = 'public'::regnamespace;`);
  if (check.length > 0) {
    console.log('✅ update_manual_voucher_draft exists');
  } else {
    console.log('❌ update_manual_voucher_draft NOT FOUND');
  }

  // 4. Verify status = 'draft' in create_manual_voucher
  const src = await runSQL(`SELECT prosrc FROM pg_proc WHERE proname = 'create_manual_voucher' AND pronamespace = 'public'::regnamespace;`);
  if (src[0]?.prosrc?.includes("'draft'")) {
    console.log('✅ create_manual_voucher sets status = draft');
  } else {
    console.log('❌ create_manual_voucher does NOT set status = draft');
  }

  // 5. Verify recall_voucher has creator check
  const recallSrc = await runSQL(`SELECT prosrc FROM pg_proc WHERE proname = 'recall_voucher' AND pronamespace = 'public'::regnamespace;`);
  if (recallSrc[0]?.prosrc?.includes('created_by')) {
    console.log('✅ recall_voucher has creator check');
  } else {
    console.log('❌ recall_voucher missing creator check');
  }

  // 6. Verify bucket
  const buckets = await runSQL(`SELECT name, public, file_size_limit FROM storage.buckets WHERE name = 'documents';`);
  if (buckets.length > 0) {
    console.log('✅ Storage bucket "documents":', JSON.stringify(buckets[0]));
  } else {
    console.log('⚠️ Storage bucket documents not found via DB — may need management API');
  }

  console.log('\n=== BACKEND DEPLOYMENT COMPLETE ===');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
