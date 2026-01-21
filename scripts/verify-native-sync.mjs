import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

const androidPublicRoot = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'public');

const walk = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const files = walk(androidPublicRoot);
const embeddedApks = files.filter(f => f.toLowerCase().endsWith('.apk'));
const embeddedDownloads = fs.existsSync(path.join(androidPublicRoot, 'downloads'));

if (embeddedDownloads || embeddedApks.length) {
  const list = embeddedApks.map(p => path.relative(projectRoot, p));
  const msg = [
    'Native sync verification failed: embedded downloads detected in Android assets.',
    embeddedDownloads ? '- Found android/app/src/main/assets/public/downloads' : null,
    ...list.map(p => `- ${p}`),
  ].filter(Boolean).join('\n');
  console.error(msg);
  process.exit(1);
}
