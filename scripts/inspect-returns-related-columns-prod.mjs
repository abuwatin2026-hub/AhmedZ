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
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const q = `
select json_build_object(
  'payments', (
    select json_agg(c.column_name order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='payments'
  ),
  'journal_entries', (
    select json_agg(c.column_name order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='journal_entries'
  ),
  'sales_returns', (
    select json_agg(c.column_name order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='sales_returns'
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
