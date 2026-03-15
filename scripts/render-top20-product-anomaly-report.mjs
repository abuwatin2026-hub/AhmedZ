import fs from 'node:fs';

const src = 'backups/product_anomaly_top20_remediation_prod.json';
const out = 'backups/product_anomaly_top20_remediation_prod.md';
const data = JSON.parse(fs.readFileSync(src, 'utf8'));

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const rows = data.top20_by_loss || [];

const lines = [];
lines.push('# Top-20 Product Anomaly Remediation');
lines.push('');
lines.push(`- Period: ${data.period.start} → ${data.period.end}`);
lines.push(`- Rows: ${data.summary.rows}`);
lines.push(`- Negative profit rows: ${data.summary.negative_profit_rows}`);
lines.push(`- Outlier margin rows: ${data.summary.outlier_margin_rows}`);
lines.push('');
lines.push('| # | Product | Qty | Sales | Cost | Profit | Margin % | Cause | Action |');
lines.push('|---|---|---:|---:|---:|---:|---:|---|---|');
rows.forEach((r, i) => {
  lines.push(`| ${i + 1} | ${String(r.item_name || '').replace(/\|/g, ' ')} | ${fmt(r.quantity_sold)} | ${fmt(r.total_sales)} | ${fmt(r.total_cost)} | ${fmt(r.total_profit)} | ${fmt(r.margin_pct)} | ${r.cause} | ${r.recommended_action} |`);
});
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(out);
