import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const ownerEmail = String(process.env.ADMIN_EMAIL || process.env.AZTA_SMOKE_OWNER_EMAIL || '').trim();
const ownerPassword = String(process.env.ADMIN_PASSWORD || process.env.AZTA_SMOKE_OWNER_PASSWORD || '').trim();
const targetItemId = String(process.env.ITEM_ID || '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a').trim();

if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase URL/key');
if (!ownerEmail || !ownerPassword) throw new Error('Missing admin credentials');

const supabase = createClient(supabaseUrl, supabaseKey);
const auth = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
if (auth.error) throw new Error(`auth_failed:${auth.error.message}`);

const rpc = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: '2000-01-01T00:00:00Z',
  p_end_date: '2100-01-01T23:59:59Z',
  p_zone_id: null,
  p_invoice_only: false,
});
if (rpc.error) throw new Error(`rpc_failed:${rpc.error.message}`);

const rows = Array.isArray(rpc.data) ? rpc.data : [];
const item = rows.find((r) => String(r?.item_id || '') === targetItemId) || null;

const out = {
  generated_at: new Date().toISOString(),
  target_item_id: targetItemId,
  item,
};

fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'backups', 'item_v10_postfix_check.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
