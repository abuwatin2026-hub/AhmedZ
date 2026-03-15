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

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY,
);
await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const rowsRes = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: start,
  p_end_date: end,
  p_zone_id: null,
  p_invoice_only: false,
});
if (rowsRes.error) {
  console.error(JSON.stringify(rowsRes.error, null, 2));
  process.exit(1);
}
const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];

const names = (n) => String(n?.ar || n?.en || '').trim();
const safe = (x) => Number(x || 0);

const analyzed = rows.map((r) => {
  const sales = safe(r.total_sales);
  const cost = safe(r.total_cost);
  const profit = safe(r.total_profit);
  const qty = safe(r.quantity_sold);
  const marginPct = sales !== 0 ? (profit / sales) * 100 : 0;
  const avgSell = qty > 0 ? sales / qty : 0;
  const avgCost = qty > 0 ? cost / qty : 0;
  let primary = 'طبيعي';
  let action = 'لا يلزم إجراء';

  if (qty <= 0 && sales > 0.01) {
    primary = 'مبيعات بدون كمية صافية';
    action = 'مراجعة خوارزمية توزيع المرتجعات/الوحدات لهذا الصنف ومصدر الوحدة';
  } else if (sales > 0.01 && marginPct < -100) {
    primary = 'هامش سالب حاد';
    action = 'تجميد بيع الصنف مؤقتاً، وفحص COGS على مستوى حركات sale_out للدفعات';
  } else if (qty > 0 && avgCost > avgSell * 1.1) {
    primary = 'سعر بيع أقل من التكلفة';
    action = 'رفع سعر البيع أو تخفيض التكلفة الشرائية أو تصحيح وحدة القياس';
  } else if (qty > 0 && avgCost <= 0 && sales > 0) {
    primary = 'تكلفة غير ممثلة';
    action = 'مراجعة تكوين الدفعات وavg_cost وتعبئة cost لحركات المخزون';
  } else if (profit < 0) {
    primary = 'هامش سالب';
    action = 'مراجعة سياسة التسعير والخصومات وربطها بتكلفة الصنف';
  }

  return {
    item_id: String(r.item_id),
    item_name: names(r.item_name),
    quantity_sold: qty,
    total_sales: Number(sales.toFixed(2)),
    total_cost: Number(cost.toFixed(2)),
    total_profit: Number(profit.toFixed(2)),
    margin_pct: Number(marginPct.toFixed(1)),
    avg_sell_per_unit: Number(avgSell.toFixed(4)),
    avg_cost_per_unit: Number(avgCost.toFixed(4)),
    cause: primary,
    recommended_action: action,
  };
});

const topByLoss = [...analyzed]
  .filter((x) => x.total_profit < 0)
  .sort((a, b) => a.total_profit - b.total_profit)
  .slice(0, 20);

const topByOutlierMargin = [...analyzed]
  .filter((x) => x.total_sales > 0 && (x.margin_pct > 100 || x.margin_pct < -100))
  .sort((a, b) => Math.abs(b.margin_pct) - Math.abs(a.margin_pct))
  .slice(0, 20);

const result = {
  period: { start, end },
  summary: {
    rows: analyzed.length,
    negative_profit_rows: analyzed.filter((x) => x.total_profit < 0).length,
    outlier_margin_rows: analyzed.filter((x) => x.total_sales > 0 && (x.margin_pct > 100 || x.margin_pct < -100)).length,
  },
  top20_by_loss: topByLoss,
  top20_by_margin_outlier: topByOutlierMargin,
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/product_anomaly_top20_remediation_prod.json', JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
