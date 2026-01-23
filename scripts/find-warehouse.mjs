import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bvkxohvxzhwqsmbgowwd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2a3hvaHZ4emh3cXNtYmdvd3dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4NTI0MjIsImV4cCI6MjA4MjQyODQyMn0.W0zSrxdszZaps-z7Le4Ykkp8J3DhLVblrE7uG42tfyY';
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

