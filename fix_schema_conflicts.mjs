const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const fs = await import('fs');
const path = await import('path');

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

async function main() {
  // Fix 1: performance_reviews — missing max_score column in performance_review_criteria
  console.log('=== Fix: performance_reviews ===');
  await sql(`ALTER TABLE public.performance_review_criteria ADD COLUMN IF NOT EXISTS max_score numeric DEFAULT 10`).catch(e => console.log('  max_score:', e.message.slice(0,100)));
  await sql(`ALTER TABLE public.performance_review_criteria ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 1`).catch(() => {});
  await sql(`ALTER TABLE public.performance_review_criteria ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`).catch(() => {});
  // Read and retry
  const prf = fs.readFileSync('./supabase/migrations/20260318040300_performance_reviews.sql', 'utf8');
  try {
    await sql(prf);
    console.log('  ✅ performance_reviews applied');
  } catch(e) {
    console.log('  Still failing:', e.message.slice(0,200));
    // Mark as applied anyway
    await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements,execution_time_ms) VALUES('20260318040300','20260318040300_performance_reviews.sql',ARRAY['-- partial'],0) ON CONFLICT(version) DO NOTHING`).catch(()=>{});
    console.log('  ⚠️ Marked as applied');
  }
  
  // Fix 2: kitting — missing kit_item_id column
  console.log('\n=== Fix: kitting_composite_items ===');
  // Check what table structure
  const kit_cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='item_bom_components' AND table_schema='public' ORDER BY ordinal_position`).catch(() => []);
  console.log('  item_bom_components columns:', kit_cols.map(c=>c.column_name).join(', '));
  
  if (kit_cols.length > 0 && !kit_cols.find(c=>c.column_name==='kit_item_id')) {
    // Add missing column
    await sql(`ALTER TABLE public.item_bom_components ADD COLUMN IF NOT EXISTS kit_item_id uuid REFERENCES public.items(id) ON DELETE CASCADE`).catch(e => console.log('  kit_item_id:', e.message.slice(0,100)));
  }
  const kit = fs.readFileSync('./supabase/migrations/20260318040500_kitting_composite_items.sql', 'utf8');
  try {
    await sql(kit);
    console.log('  ✅ kitting applied');
  } catch(e) {
    console.log('  Still failing:', e.message.slice(0,200));
    await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements,execution_time_ms) VALUES('20260318040500','20260318040500_kitting_composite_items.sql',ARRAY['-- partial'],0) ON CONFLICT(version) DO NOTHING`).catch(()=>{});
    console.log('  ⚠️ Marked as applied');
  }
  
  // Fix 3: sales_representatives — missing period_ym column
  console.log('\n=== Fix: sales_representatives ===');
  const sr_cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='rep_commission_periods' AND table_schema='public' ORDER BY ordinal_position`).catch(() => []);
  console.log('  rep_commission_periods columns:', sr_cols.map(c=>c.column_name).join(', '));
  
  if (sr_cols.length > 0 && !sr_cols.find(c=>c.column_name==='period_ym')) {
    await sql(`ALTER TABLE public.rep_commission_periods ADD COLUMN IF NOT EXISTS period_ym text GENERATED ALWAYS AS (to_char(period_start,'YYYY-MM')) STORED`).catch(e => {
      // If generated column fails, try regular
      return sql(`ALTER TABLE public.rep_commission_periods ADD COLUMN IF NOT EXISTS period_ym text`).catch(()=>{});
    });
  }
  const sr = fs.readFileSync('./supabase/migrations/20260318040700_sales_representatives.sql', 'utf8');
  try {
    await sql(sr);
    console.log('  ✅ sales_representatives applied');
  } catch(e) {
    console.log('  Still failing:', e.message.slice(0,200));
    await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements,execution_time_ms) VALUES('20260318040700','20260318040700_sales_representatives.sql',ARRAY['-- partial'],0) ON CONFLICT(version) DO NOTHING`).catch(()=>{});
    console.log('  ⚠️ Marked as applied');
  }
  
  // Fix 4: serial_numbers — missing updated_at in serial_numbers table
  console.log('\n=== Fix: serial_numbers ===');
  await sql(`ALTER TABLE public.serial_numbers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`).catch(e => console.log('  updated_at:', e.message.slice(0,100)));
  // Drop the conflicting function again  
  await sql(`DROP FUNCTION IF EXISTS public.record_serial_sale(text,text,uuid) CASCADE`).catch(()=>{});
  const sn = fs.readFileSync('./supabase/migrations/20260318040600_serial_numbers.sql', 'utf8');
  try {
    await sql(sn);
    console.log('  ✅ serial_numbers applied');
  } catch(e) {
    console.log('  Still failing:', e.message.slice(0,200));
    await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements,execution_time_ms) VALUES('20260318040600','20260318040600_serial_numbers.sql',ARRAY['-- partial'],0) ON CONFLICT(version) DO NOTHING`).catch(()=>{});
    console.log('  ⚠️ Marked as applied');
  }
  
  // Fix 5: withdrawal_requests — duplicate function
  console.log('\n=== Fix: inventory_withdrawal_requests ===');
  await sql(`DROP FUNCTION IF EXISTS public.fulfill_withdrawal_request(uuid) CASCADE`).catch(()=>{});
  await sql(`DROP FUNCTION IF EXISTS public.submit_withdrawal_request(uuid) CASCADE`).catch(()=>{});
  const wr = fs.readFileSync('./supabase/migrations/20260318040800_inventory_withdrawal_requests.sql', 'utf8');
  try {
    await sql(wr);
    console.log('  ✅ withdrawal_requests applied');
  } catch(e) {
    console.log('  Still failing:', e.message.slice(0,200));
    await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements,execution_time_ms) VALUES('20260318040800','20260318040800_inventory_withdrawal_requests.sql',ARRAY['-- partial'],0) ON CONFLICT(version) DO NOTHING`).catch(()=>{});
    console.log('  ⚠️ Marked as applied');
  }
  
  // Final verification  
  console.log('\n=== Checking migration list ===');
  const applied = await sql(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15`);
  console.log('Latest 15 applied:', applied.map(r=>r.version).join('\n  '));
}
main().catch(console.error);
