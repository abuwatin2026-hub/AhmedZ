/**
 * Deploy migration via Supabase Management API
 * Then call the RPC to purge test orders
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log('✅ Auth OK\n');

  // Step 1: Try to call the RPC directly (in case migration was already applied)
  console.log('محاولة استدعاء RPC admin_purge_test_orders_once...');
  const { data: rpcResult, error: rpcErr } = await sb.rpc('admin_purge_test_orders_once');
  
  if (rpcErr) {
    if (rpcErr.message.includes('does not exist') || rpcErr.message.includes('Could not find')) {
      console.log('  RPC غير موجودة بعد — يجب نشر migration أولاً');
      console.log('\n⚠️ لا يمكن نشر migration عبر REST API فقط المسؤول يمكنه ذلك.');
      console.log('\nيرجى تنفيذ هذا الأمر يدوياً في Supabase SQL Editor:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const sql = readFileSync(
        join(__dirname, '..', 'supabase', 'migrations', '20260403030100_purge_test_orders_rpc.sql'),
        'utf8'
      );
      console.log(sql);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\nثم نفذ: SELECT admin_purge_test_orders_once();');
    } else {
      console.error('❌ RPC error:', rpcErr.message);
    }
  } else {
    console.log('✅ تم الحذف!', JSON.stringify(rpcResult, null, 2));
    
    // Verify
    const { data: remaining } = await sb.from('orders').select('id').in('id', [
      '27523d4c-f339-4421-a4dc-612afe2e0523',
      '74bd07c2-862b-4e6e-92fb-be4e94a0aa7c',
      'c884a5d0-2d3e-45a9-82ca-88f39be50538',
      'e1c0d001-03b2-4de7-9cc2-227dfd048584',
    ]);
    console.log(`\nطلبات متبقية: ${(remaining||[]).length}`);
    if ((remaining||[]).length === 0) console.log('✅ الحذف الكامل نجح');
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
