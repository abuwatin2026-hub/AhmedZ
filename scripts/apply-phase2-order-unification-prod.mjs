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
  'supabase/migrations/20260217140000_fix_reports_accrual_basis.sql',
  'supabase/migrations/20260309230000_product_report_v9_fx_rate.sql',
  'supabase/migrations/20260309231000_fix_sales_summary_expenses_column.sql',
  'supabase/migrations/20260311211000_reports_source_of_truth_alignment.sql',
  'supabase/migrations/20260310193000_align_v10_and_quantity_movements.sql',
  'supabase/migrations/20260315013000_fix_sales_consistency_daily_day_date_ambiguity.sql',
  'supabase/migrations/20260315043000_normalize_cancelled_delivered_to_voided.sql',
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
