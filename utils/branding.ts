export const buildPdfBrandOptions = (
  settings: any,
  subtitle: string,
  extras?: { pageNumbers?: boolean; headerHeight?: number; footerHeight?: number }
) => {
  const title =
    (settings?.cafeteriaName?.ar as string) ||
    (settings?.cafeteriaName?.en as string) ||
    'تقارير';
  const logoUrl = (settings?.logoUrl as string) || '';
  const footerText = [settings?.address || '', settings?.contactNumber || '']
    .filter(Boolean)
    .join(' • ');
  const brandLines: string[] = [];
  const tax = settings?.taxSettings?.taxNumber;
  if (tax) brandLines.push(`الرقم الضريبي: ${tax}`);
  const accentColor = (settings?.brandColors?.primary as string) || '#2F2B7C';
  return {
    headerTitle: title,
    headerSubtitle: subtitle,
    logoUrl,
    footerText,
    accentColor,
    brandLines,
    pageNumbers: extras?.pageNumbers ?? true,
    headerHeight: extras?.headerHeight ?? 40,
    footerHeight: extras?.footerHeight ?? 24,
  };
};

export const buildXlsxBrandOptions = (
  settings: any,
  subtitle: string,
  headersCount: number,
  extras?: { periodText?: string }
) => {
  const title =
    (settings?.cafeteriaName?.ar as string) ||
    (settings?.cafeteriaName?.en as string) ||
    '';
  const period =
    (extras?.periodText as string) ||
    `التاريخ: ${new Date().toLocaleDateString('ar-SA')}`;
  const pad = (text: string) =>
    Array.from({ length: Math.max(1, headersCount) }, (_, i) =>
      i === 0 ? text : ''
    );
  const preludeRows = [pad(title), pad(`تقرير: ${subtitle}`), pad(period)];
  const accentColor = (settings?.brandColors?.primary as string) || '#2F2B7C';
  return { preludeRows, accentColor };
};
