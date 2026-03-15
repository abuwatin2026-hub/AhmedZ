import fs from 'node:fs';

const read = (file) => {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
};

const a = read('.env.local');
const b = read('.env.production');
const u1 = String(a.VITE_SUPABASE_URL || '');
const u2 = String(b.VITE_SUPABASE_URL || '');
const host = (u) => {
  try { return new URL(u).host; } catch { return ''; }
};

console.log(JSON.stringify({
  local_has_url: Boolean(u1),
  prod_has_url: Boolean(u2),
  local_host: host(u1),
  prod_host: host(u2),
  same_host: host(u1) && host(u1) === host(u2),
}, null, 2));
