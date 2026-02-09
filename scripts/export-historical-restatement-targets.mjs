import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

const outArg = getArg('--out');
const limitArg = Number(getArg('--limit') || 0) || 0;
const localFlag = hasFlag('--local');

const outPath = path.resolve(rootDir, outArg || 'HISTORICAL_RESTATEMENT_TARGETS.md');

const SUPABASE_URL = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.AZTA_SUPABASE_SERVICE_ROLE_KEY || '').trim();

const RESTATEMENT_EMAIL = String(process.env.RESTATEMENT_EMAIL || '').trim();
const RESTATEMENT_PASSWORD = String(process.env.RESTATEMENT_PASSWORD || '').trim();

const supabase = !localFlag
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

const mdEscape = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  resolve(child);
});

const readAll = (stream) => new Promise((resolve) => {
  let out = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => { out += d; });
  stream.on('end', () => resolve(out));
});

const splitLines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

const extractJsonObject = (s) => {
  const text = String(s || '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('psql output did not contain a JSON object payload');
  }
  return text.slice(first, last + 1);
};

const findSupabaseDbContainer = async () => {
  const child = await run('docker', ['ps', '--format', '{{.Names}}'], { cwd: rootDir });
  child.stdin.end();
  const out = await readAll(child.stdout);
  const err = await readAll(child.stderr);
  const code = await new Promise((r) => child.on('close', r));
  if (code !== 0) throw new Error(err || out || 'docker ps failed');
  const names = splitLines(out);
  const db = names.find((n) => /^supabase_db_/i.test(n));
  if (!db) throw new Error(`supabase db container not found. containers=${names.join(', ')}`);
  return db;
};

const execPsql = async ({ containerName, sql }) => {
  const args = ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-t', '-A'];
  const child = await run('docker', args, { cwd: rootDir });
  child.stdin.write(sql);
  child.stdin.end();
  const out = await readAll(child.stdout);
  const err = await readAll(child.stderr);
  const code = await new Promise((r) => child.on('close', r));
  return { code, out, err };
};

const main = async () => {
  if (localFlag) {
    const containerName = await findSupabaseDbContainer();
    const sql = [
      "select json_build_object(",
      "  'lock_date', (select locked_at::date from public.base_currency_restatement_state where id='sar_base_lock' limit 1),",
      "  'min_date', (select min(entry_date)::date from public.journal_entries),",
      "  'rows', (",
      '    select coalesce(json_agg(t order by t.entry_date asc, t.created_at asc, t.journal_entry_id asc), \'[]\'::json)',
      '    from (',
      '      select journal_entry_id, entry_date, created_at, debit_total, credit_total, memo',
      '      from public.historical_base_currency_restatement_targets',
      limitArg > 0 ? `      limit ${Math.trunc(limitArg)}` : '      ',
      '    ) t',
      '  )',
      ')::text as payload;',
    ].join('\n');
    const { code, out, err } = await execPsql({ containerName, sql });
    if (code !== 0) throw new Error(err || out || 'psql failed');
    const parsed = JSON.parse(extractJsonObject(out));

    const lockDate = parsed?.lock_date ? String(parsed.lock_date) : '—';
    const minDate = parsed?.min_date ? String(parsed.min_date) : '—';
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];

    const lines = [];
    lines.push('# HISTORICAL_RESTATEMENT_TARGETS');
    lines.push('');
    lines.push(`- From: ${minDate}`);
    lines.push(`- To (SAR lock date): ${lockDate}`);
    lines.push(`- Targets count: ${rows.length}`);
    lines.push('');
    lines.push('## Targets');
    lines.push('');
    lines.push('| # | entry_date | journal_entry_id | debit_total | credit_total | memo |');
    lines.push('|---:|---|---|---:|---:|---|');
    rows.forEach((r, idx) => {
      lines.push(
        `| ${idx + 1} | ${mdEscape(String(r.entry_date || '').slice(0, 10))} | ${mdEscape(r.journal_entry_id)} | ${Number(r.debit_total || 0)} | ${Number(r.credit_total || 0)} | ${mdEscape(r.memo || '')} |`,
      );
    });
    lines.push('');

    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    process.stdout.write(`OUT_PATH=${outPath}\n`);
    return;
  }

  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
    process.stderr.write('Missing AZTA_SUPABASE_URL and (AZTA_SUPABASE_ANON_KEY or AZTA_SUPABASE_SERVICE_ROLE_KEY)\n');
    process.exit(1);
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    if (!RESTATEMENT_EMAIL || !RESTATEMENT_PASSWORD) {
      process.stderr.write('Missing RESTATEMENT_EMAIL / RESTATEMENT_PASSWORD (or provide AZTA_SUPABASE_SERVICE_ROLE_KEY)\n');
      process.exit(1);
    }
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: RESTATEMENT_EMAIL, password: RESTATEMENT_PASSWORD });
    if (authErr) throw authErr;
  }

  const [{ data: stateRow, error: stateErr }, { data: minRow, error: minErr }] = await Promise.all([
    supabase.from('base_currency_restatement_state').select('locked_at,old_base_currency,new_base_currency').eq('id', 'sar_base_lock').maybeSingle(),
    supabase.from('journal_entries').select('entry_date').order('entry_date', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (stateErr) throw stateErr;
  if (minErr) throw minErr;

  const lockDate = stateRow?.locked_at ? String(stateRow.locked_at).slice(0, 10) : '—';
  const minDate = minRow?.entry_date ? String(minRow.entry_date).slice(0, 10) : '—';

  let q = supabase
    .from('historical_base_currency_restatement_targets')
    .select('journal_entry_id,entry_date,created_at,debit_total,credit_total,memo')
    .order('entry_date', { ascending: true })
    .order('created_at', { ascending: true })
    .order('journal_entry_id', { ascending: true });

  if (limitArg > 0) q = q.limit(limitArg);
  const { data, error } = await q;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  const lines = [];
  lines.push('# HISTORICAL_RESTATEMENT_TARGETS');
  lines.push('');
  lines.push(`- From: ${minDate}`);
  lines.push(`- To (SAR lock date): ${lockDate}`);
  lines.push(`- Targets count: ${rows.length}`);
  lines.push('');
  lines.push('## Targets');
  lines.push('');
  lines.push('| # | entry_date | journal_entry_id | debit_total | credit_total | memo |');
  lines.push('|---:|---|---|---:|---:|---|');
  rows.forEach((r, idx) => {
    lines.push(
      `| ${idx + 1} | ${mdEscape(String(r.entry_date || '').slice(0, 10))} | ${mdEscape(r.journal_entry_id)} | ${Number(r.debit_total || 0)} | ${Number(r.credit_total || 0)} | ${mdEscape(r.memo || '')} |`,
    );
  });
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  process.stdout.write(`OUT_PATH=${outPath}\n`);
};

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
