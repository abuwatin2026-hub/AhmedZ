import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.tmp',
  '.cache',
  'android',
  'ios',
  'www',
  'supabase/.temp',
]);

const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.md',
  '.css',
  '.html',
]);

const toForwardSlashes = (value) => value.replace(/\\/g, '/');

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const opts = {
    query: '',
    root: process.cwd(),
    glob: '',
    regex: false,
    ignoreCase: false,
    max: 200,
  };

  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
      continue;
    }
    if (a === '--regex') {
      opts.regex = true;
      continue;
    }
    if (a === '--ignore-case' || a === '-i') {
      opts.ignoreCase = true;
      continue;
    }
    if (a === '--path') {
      opts.root = path.resolve(process.cwd(), String(args[i + 1] || ''));
      i++;
      continue;
    }
    if (a === '--glob') {
      opts.glob = String(args[i + 1] || '');
      i++;
      continue;
    }
    if (a === '--max') {
      const n = Number(args[i + 1]);
      opts.max = Number.isFinite(n) && n > 0 ? Math.floor(n) : opts.max;
      i++;
      continue;
    }
    positionals.push(a);
  }

  opts.query = positionals.join(' ').trim();
  return opts;
};

const printHelp = () => {
  const lines = [
    'استعمال:',
    '  npm run search -- "<نص>" [--path <مسار>] [--glob "<نمط>"] [--regex] [-i] [--max <عدد>]',
    '',
    'أمثلة:',
    '  npm run search -- "close_cash_shift"',
    '  npm run search -- "ShiftManagementModal" --glob "*.tsx" --max 50',
    '  npm run search -- "status\\s*=\\s*\\x27open\\x27" --regex -i',
    '  npm run search -- "مركز المساعدة" --path screens --glob "*.tsx"',
  ];
  console.log(lines.join('\n'));
};

const compileGlobMatcher = (glob) => {
  if (!glob) return null;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const reSource = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(reSource);
};

const shouldIgnoreDir = (root, dirPath) => {
  const rel = toForwardSlashes(path.relative(root, dirPath));
  if (!rel || rel === '.') return false;
  for (const ignore of DEFAULT_IGNORES) {
    if (rel === ignore || rel.startsWith(ignore + '/')) return true;
  }
  return false;
};

const walkFiles = async function* (root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(root, fullPath)) continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) yield fullPath;
    }
  }
};

const fileLooksTextual = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return DEFAULT_EXTENSIONS.has(ext);
};

const safeReadText = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const main = async () => {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.query) {
    printHelp();
    process.exitCode = opts.query ? 0 : 1;
    return;
  }

  const root = opts.root;
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat) {
    console.error('المسار غير موجود:', root);
    process.exitCode = 1;
    return;
  }

  const globMatcher = compileGlobMatcher(opts.glob);
  const flags = opts.ignoreCase ? 'i' : '';
  const needle = opts.ignoreCase ? opts.query.toLowerCase() : opts.query;
  const re = opts.regex ? new RegExp(opts.query, flags) : null;

  let totalMatches = 0;
  let filesWithMatches = 0;

  const relOf = (p) => toForwardSlashes(path.relative(process.cwd(), p));

  for await (const filePath of walkFiles(root)) {
    if (totalMatches >= opts.max) break;
    if (!fileLooksTextual(filePath)) continue;
    if (globMatcher && !globMatcher.test(path.basename(filePath))) continue;

    const text = await safeReadText(filePath);
    if (text == null) continue;

    const lines = text.split(/\r?\n/);
    let fileHit = false;

    for (let i = 0; i < lines.length; i++) {
      if (totalMatches >= opts.max) break;
      const line = lines[i];
      const hay = opts.ignoreCase ? line.toLowerCase() : line;
      const ok = re ? re.test(line) : hay.includes(needle);
      if (!ok) continue;

      if (!fileHit) {
        filesWithMatches++;
        fileHit = true;
      }

      totalMatches++;
      console.log(`${relOf(filePath)}:${i + 1}: ${line}`);
    }
  }

  console.log(`\nالمخرجات: ${totalMatches} نتيجة داخل ${filesWithMatches} ملف`);
  if (totalMatches >= opts.max) {
    console.log(`تم الإيقاف عند الحد الأقصى --max=${opts.max}`);
  }
};

await main();

