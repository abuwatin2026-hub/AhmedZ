import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const src = 'backups/top5_autocorrect_applied_prod.json';
if (!fs.existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}
const applied = JSON.parse(fs.readFileSync(src, 'utf8'));
const changes = applied.changes || [];

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const results = [];
for (const c of changes) {
  const upd = await supabase
    .from('menu_items')
    .update({ price: Number(c.current_price || 0), status: c.current_status || 'active' })
    .eq('id', c.item_id)
    .select('id,status,price')
    .single();
  results.push({
    item_id: c.item_id,
    rollback_to_status: c.current_status,
    rollback_to_price: c.current_price,
    result: upd.error ? { error: upd.error } : upd.data,
  });
}

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/top5_autocorrect_rollback_prod.json', JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify({ items: results.length, file: 'backups/top5_autocorrect_rollback_prod.json' }, null, 2));
