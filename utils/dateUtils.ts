const pad2 = (n: number) => String(n).padStart(2, '0');

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test((value || '').trim());

export const normalizeIsoDateOnly = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isIsoDate(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return raw;
  if (y < 1900 || y > 2200) return raw;
  let month = a;
  let day = b;
  if (a > 12 && b <= 12) {
    month = b;
    day = a;
  }
  return `${y}-${pad2(month)}-${pad2(day)}`;
};

export const toYmdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const toYyyyMmLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export const toDateInputValue = (d: Date = new Date()) => toYmdLocal(d);

export const toMonthInputValue = (d: Date = new Date()) => toYyyyMmLocal(d);

export const toDateTimeLocalInputValue = (d: Date = new Date()) =>
  `${toYmdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export const toDateTimeLocalInputValueFromIso = (iso?: string) => {
  const trimmed = String(iso || '').trim();
  if (!trimmed) return '';
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return '';
  return toDateTimeLocalInputValue(d);
};

export const parseYmdToLocalDate = (value?: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const iso = normalizeIsoDateOnly(trimmed);
  if (!isIsoDate(iso)) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export const startOfDayFromYmd = (value?: string) => parseYmdToLocalDate(value);

export const endOfDayFromYmd = (value?: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const iso = normalizeIsoDateOnly(trimmed);
  if (!isIsoDate(iso)) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export const toUtcIsoFromLocalDateTimeInput = (value?: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

export const toUtcIsoAtMiddayFromYmd = (value?: string) => {
  const d = parseYmdToLocalDate(value);
  if (!d) return '';
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  return dt.toISOString();
};

export const nextMonthStartYmd = (yyyyMm: string) => {
  const trimmed = String(yyyyMm || '').trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const dt = new Date(year, month, 1, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? '' : toYmdLocal(dt);
};
