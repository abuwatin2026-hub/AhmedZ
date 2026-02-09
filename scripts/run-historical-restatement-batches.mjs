import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';

const rootDir = path.resolve(process.cwd());

const getArg = (name) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
};
const hasFlag = (name) => process.argv.includes(name);

const envFile = getArg('--env-file');
if (envFile) dotenvConfig({ path: path.resolve(rootDir, envFile) });

const outDir = path.resolve(rootDir, getArg('--out-dir') || '.');
const targetsOut = path.resolve(rootDir, getArg('--targets-out') || 'HISTORICAL_RESTATEMENT_TARGETS.md');
const batchSize = Math.max(1, Number(getArg('--batch-size') || 20) || 20);
const maxBatches = Math.max(0, Number(getArg('--max-batches') || 0) || 0);

const postingDateArg = getArg('--posting-date');
const dryRun = hasFlag('--dry-run');
const runFxRevaluation = hasFlag('--run-fx-revaluation');

const SUPABASE_URL = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.AZTA_SUPABASE_SERVICE_ROLE_KEY || '').trim();

const RESTATEMENT_EMAIL = String(process.env.RESTATEMENT_EMAIL || '').trim();
const RESTATEMENT_PASSWORD = String(process.env.RESTATEMENT_PASSWORD || '').trim();

if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
  process.stderr.write('Missing AZTA_SUPABASE_URL and (AZTA_SUPABASE_ANON_KEY or AZTA_SUPABASE_SERVICE_ROLE_KEY)\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mdEscape = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const isoDate = (d) => String(d || '').slice(0, 10);
const asIsoTs = (d) => {
  const s = String(d || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  return s;
};

const sumBy = (rows, key) => rows.reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);

const getTargets = async () => {
  const { data: stateRow, error: stateErr } = await supabase
    .from('base_currency_restatement_state')
    .select('locked_at,old_base_currency,new_base_currency')
    .eq('id', 'sar_base_lock')
    .maybeSingle();
  if (stateErr) throw stateErr;

  const { data: minRow, error: minErr } = await supabase
    .from('journal_entries')
    .select('entry_date')
    .order('entry_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (minErr) throw minErr;

  const lockDate = stateRow?.locked_at ? isoDate(stateRow.locked_at) : null;
  const minDate = minRow?.entry_date ? isoDate(minRow.entry_date) : null;

  const { data: targets, error: tErr } = await supabase
    .from('historical_base_currency_restatement_targets')
    .select('journal_entry_id,entry_date,created_at,debit_total,credit_total,memo')
    .order('entry_date', { ascending: true })
    .order('created_at', { ascending: true })
    .order('journal_entry_id', { ascending: true });
  if (tErr) throw tErr;

  return { stateRow, lockDate, minDate, targets: Array.isArray(targets) ? targets : [] };
};

const writeTargetsMd = ({ minDate, lockDate, targets }) => {
  const lines = [];
  lines.push('# HISTORICAL_RESTATEMENT_TARGETS');
  lines.push('');
  lines.push(`- From: ${minDate || '—'}`);
  lines.push(`- To (SAR lock date): ${lockDate || '—'}`);
  lines.push(`- Targets count: ${targets.length}`);
  lines.push('');
  lines.push('## Targets');
  lines.push('');
  lines.push('| # | entry_date | journal_entry_id | debit_total | credit_total | memo |');
  lines.push('|---:|---|---|---:|---:|---|');
  targets.forEach((r, idx) => {
    lines.push(
      `| ${idx + 1} | ${mdEscape(isoDate(r.entry_date))} | ${mdEscape(r.journal_entry_id)} | ${Number(r.debit_total || 0)} | ${Number(r.credit_total || 0)} | ${mdEscape(r.memo || '')} |`,
    );
  });
  lines.push('');
  fs.writeFileSync(targetsOut, lines.join('\n'), 'utf8');
};

const requireAuthIfNeeded = async () => {
  if (SUPABASE_SERVICE_ROLE_KEY) return;
  if (!RESTATEMENT_EMAIL || !RESTATEMENT_PASSWORD) {
    process.stderr.write('Missing RESTATEMENT_EMAIL / RESTATEMENT_PASSWORD (or provide AZTA_SUPABASE_SERVICE_ROLE_KEY)\n');
    process.exit(1);
  }
  const { error } = await supabase.auth.signInWithPassword({ email: RESTATEMENT_EMAIL, password: RESTATEMENT_PASSWORD });
  if (error) throw error;
};

const getMetrics = async ({ startDate, endDate }) => {
  const [{ data: tbRows, error: tbErr }, { data: plRows, error: plErr }, { data: cfRows, error: cfErr }] = await Promise.all([
    supabase.rpc('enterprise_trial_balance', {
      p_start: startDate,
      p_end: endDate,
      p_company_id: null,
      p_branch_id: null,
      p_cost_center_id: null,
      p_dept_id: null,
      p_project_id: null,
      p_currency_view: 'base',
      p_rollup: 'account',
    }),
    supabase.rpc('enterprise_profit_and_loss', {
      p_start: startDate,
      p_end: endDate,
      p_company_id: null,
      p_branch_id: null,
      p_cost_center_id: null,
      p_dept_id: null,
      p_project_id: null,
      p_rollup: 'ifrs_line',
    }),
    supabase.rpc('cash_flow_statement', { p_start: startDate, p_end: endDate }),
  ]);
  if (tbErr) throw tbErr;
  if (plErr) throw plErr;
  if (cfErr) throw cfErr;

  const tb = Array.isArray(tbRows) ? tbRows : [];
  const pl = Array.isArray(plRows) ? plRows : [];
  const cf = Array.isArray(cfRows) ? cfRows : [];

  const debitTotal = sumBy(tb, 'debit_base');
  const creditTotal = sumBy(tb, 'credit_base');

  const byType = (t) => tb.filter((r) => String(r?.account_type || '') === t);
  const assets = sumBy(byType('asset'), 'balance_base');
  const liabilities = -sumBy(byType('liability'), 'balance_base');
  const equity = -sumBy(byType('equity'), 'balance_base');
  const income = -sumBy(byType('income'), 'balance_base');
  const expenses = sumBy(byType('expense'), 'balance_base');

  const pnlTotal = sumBy(pl, 'amount_base');
  const cfRow = cf[0] || {};

  return {
    startDate,
    endDate,
    trial_balance: { debitTotal, creditTotal, assets, liabilities, equity, income, expenses },
    profit_and_loss: { total: pnlTotal, lines: pl.length },
    cash_flow: {
      operating: Number(cfRow.operating_activities || 0),
      investing: Number(cfRow.investing_activities || 0),
      financing: Number(cfRow.financing_activities || 0),
      net: Number(cfRow.net_cash_flow || 0),
      opening: Number(cfRow.opening_cash || 0),
      closing: Number(cfRow.closing_cash || 0),
    },
  };
};

const diffMetrics = (a, b) => ({
  trial_balance: Object.fromEntries(Object.keys(a.trial_balance).map((k) => [k, Number(b.trial_balance[k] || 0) - Number(a.trial_balance[k] || 0)])),
  profit_and_loss: { total: Number(b.profit_and_loss.total || 0) - Number(a.profit_and_loss.total || 0) },
  cash_flow: Object.fromEntries(Object.keys(a.cash_flow).map((k) => [k, Number(b.cash_flow[k] || 0) - Number(a.cash_flow[k] || 0)])),
});

const formatMoney = (n) => {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : '0.00';
};

const writeBatchReport = ({ batchNumber, batchResult, before, after, delta }) => {
  const p = path.join(outDir, `RESTATEMENT_BATCH_${batchNumber}_REPORT.md`);
  const lines = [];
  lines.push(`# RESTATEMENT_BATCH_${batchNumber}_REPORT`);
  lines.push('');
  lines.push(`- batch_id: ${batchResult.batch_id || '—'}`);
  lines.push(`- processed: ${batchResult.processed ?? '—'}`);
  lines.push(`- restated: ${batchResult.restated ?? '—'}`);
  lines.push(`- skipped: ${batchResult.skipped ?? '—'}`);
  lines.push(`- settlements_created: ${batchResult.settlements_created ?? '—'}`);
  lines.push(`- range: ${before.startDate} → ${before.endDate}`);
  lines.push('');
  lines.push('## Trial Balance (Before)');
  lines.push('');
  lines.push(`- debit_total: ${formatMoney(before.trial_balance.debitTotal)}`);
  lines.push(`- credit_total: ${formatMoney(before.trial_balance.creditTotal)}`);
  lines.push(`- assets: ${formatMoney(before.trial_balance.assets)}`);
  lines.push(`- liabilities: ${formatMoney(before.trial_balance.liabilities)}`);
  lines.push(`- equity: ${formatMoney(before.trial_balance.equity)}`);
  lines.push(`- income: ${formatMoney(before.trial_balance.income)}`);
  lines.push(`- expenses: ${formatMoney(before.trial_balance.expenses)}`);
  lines.push('');
  lines.push('## Trial Balance (After)');
  lines.push('');
  lines.push(`- debit_total: ${formatMoney(after.trial_balance.debitTotal)}`);
  lines.push(`- credit_total: ${formatMoney(after.trial_balance.creditTotal)}`);
  lines.push(`- assets: ${formatMoney(after.trial_balance.assets)}`);
  lines.push(`- liabilities: ${formatMoney(after.trial_balance.liabilities)}`);
  lines.push(`- equity: ${formatMoney(after.trial_balance.equity)}`);
  lines.push(`- income: ${formatMoney(after.trial_balance.income)}`);
  lines.push(`- expenses: ${formatMoney(after.trial_balance.expenses)}`);
  lines.push('');
  lines.push('## Delta (After - Before)');
  lines.push('');
  lines.push(`- assets: ${formatMoney(delta.trial_balance.assets)}`);
  lines.push(`- liabilities: ${formatMoney(delta.trial_balance.liabilities)}`);
  lines.push(`- income: ${formatMoney(delta.trial_balance.income)}`);
  lines.push(`- expenses: ${formatMoney(delta.trial_balance.expenses)}`);
  lines.push('');
  lines.push('## P&L');
  lines.push('');
  lines.push(`- before_total: ${formatMoney(before.profit_and_loss.total)}`);
  lines.push(`- after_total: ${formatMoney(after.profit_and_loss.total)}`);
  lines.push(`- delta_total: ${formatMoney(delta.profit_and_loss.total)}`);
  lines.push('');
  lines.push('## Cash Flow');
  lines.push('');
  lines.push(`- opening_cash_before: ${formatMoney(before.cash_flow.opening)}`);
  lines.push(`- closing_cash_before: ${formatMoney(before.cash_flow.closing)}`);
  lines.push(`- opening_cash_after: ${formatMoney(after.cash_flow.opening)}`);
  lines.push(`- closing_cash_after: ${formatMoney(after.cash_flow.closing)}`);
  lines.push(`- net_cash_flow_delta: ${formatMoney(delta.cash_flow.net)}`);
  lines.push('');
  lines.push('## Entries');
  lines.push('');
  const orig = Array.isArray(batchResult.original_entry_ids) ? batchResult.original_entry_ids : [];
  const rest = Array.isArray(batchResult.restated_entry_ids) ? batchResult.restated_entry_ids : [];
  lines.push(`- original_entry_ids: ${orig.length}`);
  lines.push(`- restated_entry_ids: ${rest.length}`);
  lines.push('');
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
};

const writeFinalReport = ({ targetsCount, batchReports, beforeAll, afterAll, deltaAll }) => {
  const p = path.join(outDir, 'BASE_CURRENCY_RESTATEMENT_FINAL_REPORT.md');
  const lines = [];
  lines.push('# BASE_CURRENCY_RESTATEMENT_FINAL_REPORT');
  lines.push('');
  lines.push(`- original_journal_entries_targeted: ${targetsCount}`);
  lines.push(`- batches_executed: ${batchReports.length}`);
  lines.push('');
  lines.push('## Cumulative Effect (After - Before)');
  lines.push('');
  lines.push(`- assets: ${formatMoney(deltaAll.trial_balance.assets)}`);
  lines.push(`- liabilities: ${formatMoney(deltaAll.trial_balance.liabilities)}`);
  lines.push(`- income: ${formatMoney(deltaAll.trial_balance.income)}`);
  lines.push(`- expenses: ${formatMoney(deltaAll.trial_balance.expenses)}`);
  lines.push('');
  lines.push('## Controls');
  lines.push('');
  lines.push(`- trial_balance_before_debit_total: ${formatMoney(beforeAll.trial_balance.debitTotal)}`);
  lines.push(`- trial_balance_before_credit_total: ${formatMoney(beforeAll.trial_balance.creditTotal)}`);
  lines.push(`- trial_balance_after_debit_total: ${formatMoney(afterAll.trial_balance.debitTotal)}`);
  lines.push(`- trial_balance_after_credit_total: ${formatMoney(afterAll.trial_balance.creditTotal)}`);
  lines.push('');
  lines.push('## Evidence (Append-Only)');
  lines.push('');
  lines.push('- No UPDATE/DELETE executed by this runner; only RPC-driven INSERTs were performed.');
  lines.push('- Each adjustment JE is linked by journal_entries.reference_entry_id and base_currency_restatement_entry_map.');
  lines.push('');
  lines.push('## Batch Reports');
  lines.push('');
  batchReports.forEach((r) => lines.push(`- ${path.basename(r)}`));
  lines.push('');
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
};

const main = async () => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const { lockDate, minDate, targets } = await getTargets();
  writeTargetsMd({ minDate, lockDate, targets });

  if (dryRun) {
    process.stdout.write(`TARGETS_OUT=${targetsOut}\n`);
    return;
  }

  await requireAuthIfNeeded();

  if (!lockDate || !minDate) {
    throw new Error('missing minDate/lockDate');
  }

  const postingDate = asIsoTs(postingDateArg || lockDate);
  const range = { startDate: minDate, endDate: lockDate };

  const beforeAll = await getMetrics(range);
  const batchReports = [];

  let batchNo = 0;
  while (true) {
    if (maxBatches > 0 && batchNo >= maxBatches) break;
    batchNo += 1;

    const before = await getMetrics(range);

    const { data, error } = await supabase.rpc('run_base_currency_historical_restatement', {
      p_batch: batchSize,
      p_posting_date: postingDate,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const result = {
      batch_id: row?.batch_id || null,
      processed: Number(row?.processed || 0),
      restated: Number(row?.restated || 0),
      skipped: Number(row?.skipped || 0),
      settlements_created: Number(row?.settlements_created || 0),
      original_entry_ids: row?.original_entry_ids || [],
      restated_entry_ids: row?.restated_entry_ids || [],
    };

    const after = await getMetrics(range);
    const delta = diffMetrics(before, after);

    if (Math.abs(Number(after.trial_balance.debitTotal) - Number(after.trial_balance.creditTotal)) > 0.01) {
      throw new Error(`trial balance not balanced after batch ${batchNo}`);
    }

    const reportPath = writeBatchReport({ batchNumber: batchNo, batchResult: result, before, after, delta });
    batchReports.push(reportPath);

    if (result.processed === 0) break;
    if (result.processed < batchSize) break;
  }

  const afterAll = await getMetrics(range);
  const deltaAll = diffMetrics(beforeAll, afterAll);
  const finalReport = writeFinalReport({ targetsCount: targets.length, batchReports, beforeAll, afterAll, deltaAll });

  if (runFxRevaluation) {
    const { error } = await supabase.rpc('run_fx_revaluation', { p_period_end: lockDate });
    if (error) throw error;
  }

  process.stdout.write(`TARGETS_OUT=${targetsOut}\n`);
  batchReports.forEach((p) => process.stdout.write(`BATCH_REPORT=${p}\n`));
  process.stdout.write(`FINAL_REPORT=${finalReport}\n`);
};

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});

