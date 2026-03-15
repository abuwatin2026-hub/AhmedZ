import fs from 'node:fs';

const file = 'backups/top5_autocorrect_applied_prod.json';
if (!fs.existsSync(file)) {
  console.error(`Missing ${file}`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const changes = data.changes || [];

const oldProfit = changes.reduce((a, x) => a + Number(x.old_profit_30d || 0), 0);
const projected = changes.reduce((a, x) => a + Number(x.projected_profit_30d || 0), 0);
const archived = changes.filter((x) => x.mode === 'archive').length;
const repriced = changes.filter((x) => x.mode === 'reprice').length;

const out = {
  items: changes.length,
  archived,
  repriced,
  old_profit_30d_total: Number(oldProfit.toFixed(2)),
  projected_profit_30d_total: Number(projected.toFixed(2)),
  projected_delta: Number((projected - oldProfit).toFixed(2)),
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/top5_autocorrect_impact_summary_prod.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
