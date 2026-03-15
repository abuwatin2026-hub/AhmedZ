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

const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();
const { data, error } = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: start,
  p_end_date: end,
  p_zone_id: null,
  p_invoice_only: false,
});
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
const keys = [
  'ماء طيبة صغير صغير12*750ملي',
  'تونة حلوة كبير',
  'كريمة جاهزه صفاء منوع',
  'ببسي جوي كولا',
  'حليب صفاء اكياس',
  'مكرونه طويل',
];
const rows = (data || [])
  .filter((x) => {
    const n = String(x?.item_name?.ar || x?.item_name?.en || '');
    return keys.some((k) => n.includes(k));
  })
  .map((x) => ({
    item_id: x.item_id,
    item_name: x.item_name?.ar || x.item_name?.en,
    quantity_sold: x.quantity_sold,
    total_sales: x.total_sales,
    total_cost: x.total_cost,
    total_profit: x.total_profit,
    current_cost_price: x.current_cost_price,
  }));

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/probe_image_items_prod.json', JSON.stringify({ start, end, rows }, null, 2), 'utf8');
console.log(JSON.stringify({ start, end, rows }, null, 2));
