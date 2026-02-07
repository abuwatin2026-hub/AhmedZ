import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(process.cwd());
const getArg = (name) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
};

const sqlArg = getArg('--sql');
const reportArg = getArg('--report');
const okTokenArg = getArg('--ok-token');

const sqlPath = path.resolve(rootDir, sqlArg || path.join('supabase', 'smoke', 'smoke_full_enterprise_system.sql'));
const reportPath = path.resolve(rootDir, reportArg || 'SMOKE_FULL_ENTERPRISE_REPORT.md');
const okToken = String(okTokenArg || 'FULL_SYSTEM_SMOKE_OK');

const nowIso = () => new Date().toISOString();

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

const splitLines = (s) => String(s || '').split(/\r?\n/);

const parseNotices = (allText) => {
  const steps = [];
  for (const line of splitLines(allText)) {
    const m = line.match(/NOTICE:\s+(SMOKE_PASS\|.+)$/);
    if (!m) continue;
    const payload = m[1];
    const parts = payload.split('|');
    if (parts.length < 5) continue;
    const [, code, name, msStr, details] = parts;
    steps.push({
      code: String(code || '').trim(),
      name: String(name || '').trim(),
      ms: Number(msStr || 0) || 0,
      details: String(details || '').trim(),
    });
  }
  return steps;
};

const parseFailure = (allText) => {
  for (const line of splitLines(allText)) {
    const m = line.match(/ERROR:\s+SMOKE_FAIL\|([^|]+)\|([^|]+)\|(.+)$/);
    if (!m) continue;
    const [, code, name, details] = m;
    return { code: String(code || '').trim(), name: String(name || '').trim(), details: String(details || '').trim() };
  }
  return null;
};

const formatMd = ({ ok, steps, errorText, startedAt, finishedAt }) => {
  const passCount = steps.length;
  const failCount = ok ? 0 : 1;
  const totalMs = steps.reduce((s, x) => s + (Number(x.ms) || 0), 0);
  const lastStep = steps.length ? steps[steps.length - 1] : null;
  const failure = ok ? null : parseFailure(errorText);

  const lines = [];
  lines.push(`# تقرير اختبار دخان شامل (Full Enterprise Smoke)`);
  lines.push('');
  lines.push(`- وقت البدء: ${startedAt}`);
  lines.push(`- وقت النهاية: ${finishedAt}`);
  lines.push(`- الحالة: ${ok ? 'PASS' : 'FAIL'}`);
  lines.push(`- عدد الاختبارات الناجحة: ${passCount}`);
  lines.push(`- عدد الاختبارات الفاشلة: ${failCount}`);
  lines.push(`- الزمن الإجمالي (تقريبي): ${totalMs} ms`);
  if (!ok) {
    lines.push(`- آخر خطوة مكتملة: ${lastStep ? `${lastStep.code} — ${lastStep.name}` : '—'}`);
  }
  lines.push('');
  lines.push(`## نتائج الخطوات`);
  lines.push('');
  if (steps.length === 0) {
    lines.push(`- لا توجد خطوات مسجلة في المخرجات.`);
  } else {
    for (const s of steps) {
      lines.push(`- ✅ ${s.code} — ${s.name} (${s.ms} ms) ${s.details && s.details !== '{}' ? `| ${s.details}` : ''}`.trim());
    }
  }
  if (failure) {
    lines.push(`- ❌ ${failure.code} — ${failure.name} | ${failure.details}`.trim());
  }
  lines.push('');
  if (!ok) {
    lines.push(`## سجل الخطأ`);
    lines.push('');
    lines.push('```');
    lines.push(String(errorText || '').trim());
    lines.push('```');
    lines.push('');
  }
  lines.push(`## تقييم جاهزية الإنتاج`);
  lines.push('');
  if (ok) {
    lines.push(`- جاهز من منظور Smoke Test: نعم`);
    lines.push(`- مخاطر محاسبية مكتشفة: لا`);
    lines.push(`- خروقات صلاحيات مكتشفة: لا`);
  } else {
    lines.push(`- جاهز من منظور Smoke Test: لا`);
    lines.push(`- مخاطر محاسبية/تشغيلية محتملة: مرتفعة حتى معالجة سبب الفشل`);
    lines.push(`- التوصية: إصلاح السبب ثم إعادة تشغيل smoke:full حتى PASS`);
  }
  lines.push('');
  return lines.join('\n');
};

const findSupabaseDbContainer = async () => {
  const child = await run('docker', ['ps', '--format', '{{.Names}}'], { cwd: rootDir });
  child.stdin.end();
  const out = await readAll(child.stdout);
  const err = await readAll(child.stderr);
  const code = await new Promise((r) => child.on('close', r));
  if (code !== 0) throw new Error(err || out || 'docker ps failed');
  const names = splitLines(out).map((x) => x.trim()).filter(Boolean);
  const db = names.find((n) => /^supabase_db_/i.test(n));
  if (!db) throw new Error(`supabase db container not found. containers=${names.join(', ')}`);
  return db;
};

const execPsql = async ({ containerName, sql }) => {
  const args = ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const child = await run('docker', args, { cwd: rootDir });
  child.stdin.write(sql);
  child.stdin.end();
  const out = await readAll(child.stdout);
  const err = await readAll(child.stderr);
  const code = await new Promise((r) => child.on('close', r));
  return { code, out, err };
};

const main = async () => {
  const startedAt = nowIso();
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL smoke script not found: ${sqlPath}`);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const containerName = await findSupabaseDbContainer();
  const { code, out, err } = await execPsql({ containerName, sql });

  const combined = `${out}\n${err}`;
  const steps = parseNotices(combined);
  const ok = code === 0 && combined.includes(okToken);
  const finishedAt = nowIso();

  const report = formatMd({ ok, steps, errorText: combined, startedAt, finishedAt });
  fs.writeFileSync(reportPath, report, 'utf8');

  process.stdout.write(out);
  if (err) process.stderr.write(err);

  process.stdout.write(`\nREPORT_PATH=${reportPath}\n`);

  if (!ok) {
    process.exit(1);
  }
  process.stdout.write(`\n${okToken}\n`);
};

main().catch((e) => {
  const finishedAt = nowIso();
  const report = formatMd({ ok: false, steps: [], errorText: String(e?.stack || e), startedAt: finishedAt, finishedAt });
  fs.writeFileSync(reportPath, report, 'utf8');
  process.stderr.write(String(e?.stack || e) + '\n');
  process.stderr.write(`REPORT_PATH=${reportPath}\n`);
  process.exit(1);
});
