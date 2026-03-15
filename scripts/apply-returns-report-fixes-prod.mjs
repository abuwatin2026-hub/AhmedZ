import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY,
);

const files = [
  'supabase/migrations/20260309231000_fix_sales_summary_expenses_column.sql',
  'supabase/migrations/20260309230000_product_report_v9_fx_rate.sql',
  'supabase/migrations/20260310000000_product_report_v10.sql',
  'supabase/migrations/20260315022000_guard_sales_return_inventory_reference.sql',
  'supabase/migrations/20260315030000_backfill_sales_returns_from_orphan_return_movements.sql',
];

for (const file of files) {
  const sql = fs.readFileSync(file, 'utf8');
  const { error } = await supabase.rpc('exec_debug_sql', { q: sql });
  if (error) {
    console.error(JSON.stringify({ ok: false, file, error }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, file }));
}
