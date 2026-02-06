const units = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

const joinParts = (parts: string[]) => parts.filter(Boolean).join(' و ');

const twoDigits = (n: number) => {
  if (n <= 0) return '';
  if (n < 10) return units[n];
  if (n < 20) return teens[n - 10];
  const u = n % 10;
  const t = Math.floor(n / 10);
  return joinParts([u ? units[u] : '', tens[t]]);
};

const threeDigits = (n: number) => {
  if (n <= 0) return '';
  const h = Math.floor(n / 100);
  const r = n % 100;
  return joinParts([h ? hundreds[h] : '', twoDigits(r)]);
};

const groupName = (idx: number, n: number) => {
  if (idx === 1) {
    if (n === 1) return 'ألف';
    if (n === 2) return 'ألفان';
    if (n >= 3 && n <= 10) return 'آلاف';
    return 'ألف';
  }
  if (idx === 2) {
    if (n === 1) return 'مليون';
    if (n === 2) return 'مليونان';
    if (n >= 3 && n <= 10) return 'ملايين';
    return 'مليون';
  }
  if (idx === 3) {
    if (n === 1) return 'مليار';
    if (n === 2) return 'ملياران';
    if (n >= 3 && n <= 10) return 'مليارات';
    return 'مليار';
  }
  return '';
};

const integerToWords = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '';
  const groups: number[] = [];
  let x = Math.floor(n);
  while (x > 0) {
    groups.push(x % 1000);
    x = Math.floor(x / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const words = threeDigits(g);
    if (i === 0) {
      parts.push(words);
      continue;
    }
    const name = groupName(i, g);
    if (g === 1 && (i === 1 || i === 2 || i === 3)) {
      parts.push(name);
      continue;
    }
    if (g === 2 && (i === 1 || i === 2 || i === 3)) {
      parts.push(name);
      continue;
    }
    parts.push([words, name].filter(Boolean).join(' '));
  }
  return joinParts(parts);
};

export const amountToArabicWords = (amount: number, currencyLabel = 'ريال') => {
  const v = Number(amount || 0);
  if (!Number.isFinite(v) || v === 0) return `صفر ${currencyLabel}`;
  const sign = v < 0 ? 'سالب ' : '';
  const abs = Math.abs(v);
  const intPart = Math.floor(abs);
  const frac = Math.round((abs - intPart) * 100);
  const intWords = integerToWords(intPart) || 'صفر';
  const fracWords = frac ? twoDigits(frac) : '';
  const fracLabel = 'فلس';
  return frac
    ? `${sign}${intWords} ${currencyLabel} و ${fracWords} ${fracLabel}`
    : `${sign}${intWords} ${currencyLabel}`;
};
