import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function runSmokeSql(opts: { sqlRelPath: string; okToken: string; reportNamePrefix: string }) {
  const rootDir = path.resolve(process.cwd());
  const reportDir = path.resolve(rootDir, 'playwright', '.reports');
  fs.mkdirSync(reportDir, { recursive: true });

  const reportPath = path.join(reportDir, `${opts.reportNamePrefix}-${Date.now()}.md`);

  execFileSync(
    'node',
    [
      'scripts/smoke-full.mjs',
      '--sql',
      opts.sqlRelPath,
      '--report',
      reportPath,
      '--ok-token',
      opts.okToken,
    ],
    { cwd: rootDir, stdio: 'inherit' }
  );

  return reportPath;
}

