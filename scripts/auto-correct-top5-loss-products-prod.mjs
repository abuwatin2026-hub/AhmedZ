import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.env.APPLY_FIX === '1';
const PRICE_MARKUP = Number(process.env.PRICE_MARKUP || 1.12);

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY,
);
await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

const anomalyPath = 'backups/product_anomaly_top20_remediation_prod.json';
if (!fs.existsSync(anomalyPath)) {
  console.error(`Missing ${anomalyPath}`);
  process.exit(1);
}
const anomaly = JSON.parse(fs.readFileSync(anomalyPath, 'utf8'));
const top5 = (anomaly.top20_by_loss || []).slice(0, 5);

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const choosePlan = (row, currentPrice) => {
  const margin = Number(row.margin_pct || 0);
  const avgCost = Number(row.avg_cost_per_unit || 0);
  const severe = margin <= -500 || avgCost > Math.max(1, Number(row.avg_sell_per_unit || 0)) * 3;
  if (severe) {
    return { mode: 'archive', new_price: currentPrice };
  }
  const target = round2(Math.max(currentPrice, avgCost * PRICE_MARKUP));
  return { mode: 'reprice', new_price: target };
};

const changes = [];
for (const row of top5) {
  const itemId = row.item_id;
  const { data: item, error } = await supabase
    .from('menu_items')
    .select('id,price,status,data')
    .eq('id', itemId)
    .single();
  if (error || !item) {
    changes.push({ item_id: itemId, error: error || 'not_found' });
    continue;
  }

  const currentPrice = Number(item.price || 0);
  const plan = choosePlan(row, currentPrice);
  const projectedSales = round2((Number(row.quantity_sold || 0) * Number(plan.new_price || 0)));
  const projectedProfit = round2(projectedSales - Number(row.total_cost || 0));

  const one = {
    item_id: itemId,
    item_name: row.item_name,
    current_status: item.status,
    current_price: currentPrice,
    mode: plan.mode,
    target_price: plan.new_price,
    old_profit_30d: round2(row.total_profit),
    projected_profit_30d: projectedProfit,
  };

  if (APPLY) {
    if (plan.mode === 'archive') {
      const nextData = { ...(item.data || {}), autoCorrectionAt: new Date().toISOString(), autoCorrectionReason: 'top5_loss_archive' };
      const upd = await supabase
        .from('menu_items')
        .update({ status: 'archived', data: nextData })
        .eq('id', itemId)
        .select('id,status,price')
        .single();
      one.applied = upd.error ? { error: upd.error } : upd.data;
    } else {
      const nextData = { ...(item.data || {}), price: plan.new_price, autoCorrectionAt: new Date().toISOString(), autoCorrectionReason: 'top5_loss_reprice' };
      const upd = await supabase
        .from('menu_items')
        .update({ price: plan.new_price, data: nextData })
        .eq('id', itemId)
        .select('id,status,price')
        .single();
      one.applied = upd.error ? { error: upd.error } : upd.data;
    }
  }
  changes.push(one);
}

const result = {
  apply_mode: APPLY ? 'apply' : 'dry_run',
  price_markup: PRICE_MARKUP,
  created_at: new Date().toISOString(),
  changes,
};

fs.mkdirSync('backups', { recursive: true });
const out = APPLY
  ? 'backups/top5_autocorrect_applied_prod.json'
  : 'backups/top5_autocorrect_plan_prod.json';
fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ out, items: changes.length, apply: APPLY }, null, 2));
