import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('batches')
    .select('warehouse_id, item_id, expiry_date')
    .gte('expiry_date', today)
    .limit(1);
  if (error) {
    console.error('ERR:', error.message);
    process.exit(1);
  }
  const row = (data || [])[0];
  if (!row?.warehouse_id) {
    console.log('NO_WAREHOUSE');
    process.exit(0);
  }
  console.log(String(row.warehouse_id));
}

main().catch(e => {
  console.error('ERR:', e?.message || e);
  process.exit(1);
});

