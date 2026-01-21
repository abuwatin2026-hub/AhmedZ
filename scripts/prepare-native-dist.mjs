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
const androidDownloads = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'public', 'downloads');
const backupRoot = path.join(projectRoot, '.tmp', 'native-sync-backup');
const backupDownloads = path.join(backupRoot, 'downloads');

removeIfExists(backupRoot);
if (fs.existsSync(distDownloads)) {
  copyDir(distDownloads, backupDownloads);
  removeIfExists(distDownloads);
}

removeIfExists(androidDownloads);
