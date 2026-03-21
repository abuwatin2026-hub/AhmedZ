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

// Migrations that are NOT on remote (second column empty from migration list)
const pendingTimestamps = [
  '20260317060500',
  '20260318010000',
  '20260318010100',
  '20260318020000',
  '20260318020100',
  '20260318040000',
  '20260318040100',
  '20260318040200',
  '20260318040300',
  '20260318040400',
  '20260318040500',
  '20260318040600',
  '20260318040700',
  '20260318040800',
  '20260318040900',
  '20260318150000',
  '20260318200000',
  '20260319003000',
  '20260319010000',
  '20260319020000',
  '20260319030000',
  '20260319040000',
  '20260321000000',
  '20260321010000',
  '20260321020000',
  '20260321030000',
  '20260321040000',
  '20260321060000',
  // 20260321070000 = debug trace function (optional)
  '20260322010000', // THE REAL FIX: rebuild_order_line_items
];

const migrationsDir = './supabase/migrations';

async function main() {
  // Find migration files for each pending timestamp
  const allFiles = fs.readdirSync(migrationsDir).sort();
  
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const ts of pendingTimestamps) {
    const matchingFile = allFiles.find(f => f.startsWith(ts));
    if (!matchingFile) {
      console.log(`⚠️  No file found for timestamp ${ts}`);
      continue;
    }
    
    const filePath = path.join(migrationsDir, matchingFile);
    const content = fs.readFileSync(filePath, 'utf8');
    
    process.stdout.write(`Applying ${matchingFile}... `);
    
    try {
      await sql(content);
      // Record in supabase_migrations table
      await sql(`
        INSERT INTO supabase_migrations.schema_migrations(version, name, statements, execution_time_ms)
        VALUES ('${ts}', '${matchingFile}', ARRAY['-- applied via script'], 0)
        ON CONFLICT (version) DO NOTHING
      `).catch(() => {}); // ignore if table doesn't exist or conflict
      
      console.log('✅ OK');
      successCount++;
    } catch (e) {
      const errMsg = e.message.slice(0, 200);
      console.log(`❌ FAILED: ${errMsg}`);
      errors.push({ file: matchingFile, error: errMsg });
      failCount++;
    }
  }
  
  console.log(`\n=== Done: ${successCount} succeeded, ${failCount} failed ===`);
  if (errors.length > 0) {
    console.log('\nFailed migrations:');
    errors.forEach(e => console.log(`  • ${e.file}: ${e.error}`));
  }
}
main().catch(console.error);
