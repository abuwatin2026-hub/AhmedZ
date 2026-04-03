const fs = require('fs');
const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function executeSql(queryStr) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: queryStr }),
  });
  
  const b = await r.json();
  if (!r.ok) {
    throw new Error(JSON.stringify(b, null, 2));
  }
  return b;
}

async function run() {
  try {
    console.log('Reading apply_multi_wh.sql...');
    let sql = fs.readFileSync('apply_multi_wh.sql', 'utf8');
    
    console.log('Deploying to production Supabase...');
    const result = await executeSql(sql);
    console.log('Success!', result);
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();
