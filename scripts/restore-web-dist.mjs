import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

const ensureDir = (absolutePath) => {
  fs.mkdirSync(absolutePath, { recursive: true });
};

const removeIfExists = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) return;
  fs.rmSync(absolutePath, { recursive: true, force: true });
};

const copyDir = (from, to) => {
  ensureDir(to);
  fs.cpSync(from, to, { recursive: true, force: true });
};

const distDownloads = path.join(projectRoot, 'dist', 'downloads');
const backupRoot = path.join(projectRoot, '.tmp', 'native-sync-backup');
const backupDownloads = path.join(backupRoot, 'downloads');

if (fs.existsSync(backupDownloads)) {
  removeIfExists(distDownloads);
  copyDir(backupDownloads, distDownloads);
  removeIfExists(backupRoot);
}
