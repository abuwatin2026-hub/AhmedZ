import { spawn } from 'node:child_process';

const run = (label, cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) process.stderr.write(`[${label}] exited with code ${code}\n`);
  });
  return { child, done: new Promise((resolve) => child.on('exit', resolve)) };
};

const children = [];

const main = async () => {
  const start = run('supabase:start', 'npx', ['supabase', 'start']);
  children.push(start.child);
  const startCode = await start.done;
  if (startCode && startCode !== 0) process.exit(Number(startCode));

  const fn = run('supabase:functions', 'npx', ['supabase', 'functions', 'serve', 'create-admin-customer', 'create-admin-user', 'reset-admin-password', 'delete-admin-user', '--no-verify-jwt']);
  children.push(fn.child);

  const vite = run('vite', 'node', ['--max-old-space-size=8192', './node_modules/vite/bin/vite.js']);
  children.push(vite.child);

  const code = await Promise.race([fn.done, vite.done]);
  if (code && code !== 0) process.exit(Number(code));
};

const shutdown = () => {
  for (const c of children) {
    try {
      if (!c.killed) c.kill('SIGINT');
    } catch {
    }
  }
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  shutdown();
  process.exit(1);
});
