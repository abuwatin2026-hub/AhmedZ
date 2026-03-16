import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
const supabaseUrl = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const ownerEmail = String(process.env.ADMIN_EMAIL || process.env.AZTA_SMOKE_OWNER_EMAIL || '').trim();
const ownerPassword = String(process.env.ADMIN_PASSWORD || process.env.AZTA_SMOKE_OWNER_PASSWORD || '').trim();
if (!password) throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase URL/key');
if (!ownerEmail || !ownerPassword) throw new Error('Missing admin credentials');

const itemId = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a';
const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-south-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const factor = await client.query(
  `select item_id::text as item_id, qty_factor, active, note
   from public.product_report_legacy_qty_factors
   where item_id::text = $1`,
  [itemId]
);
const v11Exists = await client.query(
  `select exists(
     select 1 from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_product_sales_report_v11'
   ) as exists`
);
const v10def = await client.query(
  `select pg_get_functiondef(p.oid) as def
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='get_product_sales_report_v10'
   order by p.oid desc limit 1`
);
await client.end();

const sb = createClient(supabaseUrl, supabaseKey);
const auth = await sb.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
if (auth.error) throw new Error(`auth_failed:${auth.error.message}`);
const r10 = await sb.rpc('get_product_sales_report_v10', {
  p_start_date: '2000-01-01T00:00:00Z',
  p_end_date: '2100-01-01T23:59:59Z',
  p_zone_id: null,
  p_invoice_only: false,
});
if (r10.error) throw new Error(`v10_failed:${r10.error.message}`);
const row10 = (r10.data || []).find((r) => String(r?.item_id || '') === itemId) || null;
const r11 = await sb.rpc('get_product_sales_report_v11', {
  p_start_date: '2000-01-01T00:00:00Z',
  p_end_date: '2100-01-01T23:59:59Z',
  p_zone_id: null,
  p_invoice_only: false,
});

const out = {
  generated_at: new Date().toISOString(),
  factor_rows: factor.rows,
  v11_exists_in_db: Boolean(v11Exists.rows?.[0]?.exists),
  v10_multiplies_sales_by_factor: String(v10def.rows?.[0]?.def || '').includes('(a.aligned_sales * a.qty_factor)::numeric as total_sales'),
  v10_item: row10,
  v11_call_error: r11.error ? { code: r11.error.code, message: r11.error.message } : null,
};

fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'backups', 'rollback_product_report_verify.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
