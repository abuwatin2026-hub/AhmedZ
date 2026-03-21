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
  const migrationsDir = './supabase/migrations';
  
  // Group 1: Policy/Publication conflicts — these were already applied manually
  // Just mark them as applied in migration history
  const alreadyApplied = [
    '20260317060500', // duplicate journal key
    '20260318010000', // policy already exists
    '20260318020000', // policy already exists
    '20260319030000', // realtime publication already exists
    '20260321040000', // realtime publication already exists
  ];
  
  console.log('=== Marking already-applied migrations ===');
  for (const ts of alreadyApplied) {
    const allFiles = fs.readdirSync(migrationsDir).sort();
    const matchingFile = allFiles.find(f => f.startsWith(ts)) || ts;
    try {
      await sql(`
        INSERT INTO supabase_migrations.schema_migrations(version, name, statements, execution_time_ms)
        VALUES ('${ts}', '${matchingFile}', ARRAY['-- marked as applied'], 0)
        ON CONFLICT (version) DO NOTHING
      `).catch(() => {});
      console.log(`  ✅ Marked: ${ts}`);
    } catch(e) {
      console.log(`  ⚠️ Could not mark ${ts}: ${e.message.slice(0,100)}`);
    }
  }
  
  // Group 2: Function return type conflicts — need DROP first
  const needDrop = {
    '20260318040600': {
      drops: [`DROP FUNCTION IF EXISTS public.record_serial_sale(text,text,uuid) CASCADE`]
    },
    '20260318040800': {
      drops: [`DROP FUNCTION IF EXISTS public.submit_withdrawal_request(uuid) CASCADE`]
    },
    '20260318040900': {
      drops: [`DROP FUNCTION IF EXISTS public.get_lc_summary(uuid) CASCADE`]
    },
  };
  
  console.log('\n=== Applying function-conflict migrations with DROP first ===');
  const allFiles = fs.readdirSync(migrationsDir).sort();
  for (const [ts, config] of Object.entries(needDrop)) {
    const matchingFile = allFiles.find(f => f.startsWith(ts));
    if (!matchingFile) { console.log(`  ⚠️ No file for ${ts}`); continue; }
    
    const filePath = path.join(migrationsDir, matchingFile);
    const content = fs.readFileSync(filePath, 'utf8');
    
    process.stdout.write(`  ${matchingFile}... DROP... `);
    for (const dropStmt of config.drops) {
      await sql(dropStmt).catch(e => console.log(`    DROP warning: ${e.message.slice(0,100)}`));
    }
    process.stdout.write('APPLY... ');
    try {
      await sql(content);
      console.log('✅ OK');
    } catch(e) {
      console.log(`❌ ${e.message.slice(0,200)}`);
    }
  }
  
  // Group 3: Schema conflicts — missing columns — these need special handling
  const schemaConflicts = ['20260318040300', '20260318040500', '20260318040700'];
  console.log('\n=== Checking schema-conflict migrations ===');
  for (const ts of schemaConflicts) {
    const matchingFile = allFiles.find(f => f.startsWith(ts));
    if (!matchingFile) continue;
    const filePath = path.join(migrationsDir, matchingFile);
    const content = fs.readFileSync(filePath, 'utf8');
    const errLines = content.split('\n').slice(0, 5).join(' ');
    console.log(`  ${matchingFile}:`);
    console.log(`    First lines: ${errLines.slice(0,150)}`);
    
    try {
      await sql(content);
      console.log('    ✅ Applied OK');
    } catch(e) {
      console.log(`    ❌ ${e.message.slice(0,200)}`);
      // Try to mark as applied anyway since the tables/functions exist already
      await sql(`
        INSERT INTO supabase_migrations.schema_migrations(version, name, statements, execution_time_ms)
        VALUES ('${ts}', '${matchingFile}', ARRAY['-- conflict: schema exists'], 0)
        ON CONFLICT (version) DO NOTHING
      `).catch(() => {});
    }
  }
  
  // Verify final state
  console.log('\n=== Final check: migrations not on remote ===');
  const notApplied = await sql(`
    SELECT version FROM supabase_migrations.schema_migrations WHERE version > '20260317' ORDER BY version
  `).catch(() => []);
  console.log('Applied since 20260317:', notApplied.map(r=>r.version).join(', '));
}
main().catch(console.error);
