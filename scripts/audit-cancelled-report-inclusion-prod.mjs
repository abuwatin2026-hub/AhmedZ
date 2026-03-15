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
await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

const q = `
with cad as (
  select
    o.id,
    nullif(o.data->>'paidAt','')::timestamptz as paid_at,
    coalesce(nullif((o.data->>'total')::numeric, null), 0) as total_foreign,
    public.order_fx_rate(
      coalesce(nullif(btrim(coalesce(o.currency,'')),''), nullif(btrim(coalesce(o.data->>'currency','')),''), public.get_base_currency()),
      coalesce(nullif(o.data->>'paidAt','')::timestamptz, nullif(o.data->>'deliveredAt','')::timestamptz, o.created_at),
      o.fx_rate
    ) as fx_rate
  from public.orders o
  where o.status='cancelled'
    and nullif(trim(coalesce(o.data->>'deliveredAt','')), '') is not null
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
)
select json_build_object(
  'cad_total', count(*),
  'cad_with_paid_at', count(*) filter (where paid_at is not null),
  'cad_included_by_sales_summary_logic', count(*) filter (where paid_at is not null),
  'cad_total_base_amount', coalesce(sum(total_foreign * fx_rate),0),
  'cad_included_base_amount', coalesce(sum(case when paid_at is not null then total_foreign * fx_rate else 0 end),0)
) as payload
from cad
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/cancelled_report_inclusion_audit_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
