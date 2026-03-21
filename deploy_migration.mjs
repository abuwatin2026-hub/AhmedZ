/**
 * Deploy migration: 20260322002800_batch_purge_false_credit_payments.sql
 * Uses the Supabase Management API SQL execution endpoint
 * with the personal access token (sbp_...)
 */
import fs from 'fs';

const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const PROJECT_REF = 'pmhivhtaoydfolseelyc';

const sql = fs.readFileSync(
  './supabase/migrations/20260322002800_batch_purge_false_credit_payments.sql',
  'utf-8'
);

async function runMigration() {
  console.log('Deploying migration to production...\n');
  console.log('SQL length:', sql.length, 'chars\n');

  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SBP}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!r.ok) {
    console.error('❌ Migration FAILED:', r.status, data);
    process.exit(1);
  }

  console.log('✅ Migration response:', JSON.stringify(data, null, 2));
}

runMigration().catch(e => { console.error('Fatal:', e); process.exit(1); });
