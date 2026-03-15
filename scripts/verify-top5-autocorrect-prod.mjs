import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const path = 'backups/top5_autocorrect_applied_prod.json';
if (!fs.existsSync(path)) {
  console.error(`Missing ${path}`);
  process.exit(1);
}
const applied = JSON.parse(fs.readFileSync(path, 'utf8'));
const ids = (applied.changes || []).map((x) => x.item_id).filter(Boolean);

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const { data, error } = await supabase
  .from('menu_items')
  .select('id,price,status')
  .in('id', ids)
  .order('id');

if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/top5_autocorrect_verify_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
