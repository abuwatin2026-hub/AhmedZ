/**
 * Print Utilities
 * مكتبة مساعدة للطباعة
 */

/**
 * Extract <style> tags from an HTML string, returning { styles, bodyHtml }.
 * This allows component-owned CSS to be hoisted into <head> so it wins
 * over any global reset (e.g. * { margin:0; padding:0 }).
 */
const hoistComponentStyles = (content: string): { hoistedCss: string; bodyHtml: string } => {
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let hoistedCss = '';
  const bodyHtml = content.replace(styleRegex, (_match, css) => {
    hoistedCss += css + '\n';
    return '';
  });
  return { hoistedCss, bodyHtml };
};

/**
 * فتح نافذة الطباعة
 */
export const buildPrintHtml = (content: string, title: string = 'طباعة', options?: { page?: 'A5' | 'A4' | 'auto', extraStyles?: string, includeAppStyles?: boolean }) => {
  const page = options?.page || 'A5';
  // A4 and A5 both use margin:0 — the component handles its own internal padding.
  // Using margin:0 prevents the browser from adding extra margins that cause overflow/clipping.
  const pageCss = page === 'A5'
    ? `@page { size: A5; margin: 0; }`
    : page === 'A4'
    ? `@page { size: A4 portrait; margin: 0; }`
    : ``;

  // Hoist any <style> blocks from the component into <head> so they
  // take precedence over the global reset below.
  const { hoistedCss, bodyHtml } = hoistComponentStyles(content);

  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <base href="${window.location.origin}">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      ${options?.extraStyles ? `<style>${options.extraStyles}</style>` : ''}
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; padding: 0; margin: 0; width: 100%; }
        @media print {
          body { padding: 0; }
          .no-print { display: none !important; }
          ${pageCss}
        }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { padding: 8px; text-align: right; border: 1px solid #ddd; }
        th { background-color: #f3f4f6; font-weight: bold; }
        .text-center { text-align: center; }
        .text-left { text-align: left; }
        .font-bold { font-weight: bold; }
        .mb-2 { margin-bottom: 8px; }
        .mb-4 { margin-bottom: 16px; }
        .mt-4 { margin-top: 16px; }
        .border-b { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h1 { font-size: 24px; margin-bottom: 5px; }
        .header p { color: #666; font-size: 14px; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .total-row { background-color: #f9fafb; font-weight: bold; font-size: 16px; }
      </style>
      ${hoistedCss ? `<style>/* Component styles hoisted from body */\n${hoistedCss}</style>` : ''}
    </head>
    <body class="allow-full-print">
      ${bodyHtml}
    </body>
    </html>
  `;
};

export const printContent = (content: string, title: string = 'طباعة', options?: { page?: 'A5' | 'A4' | 'auto', includeAppStyles?: boolean }) => {
  let extraStyles = '';
  if (options?.includeAppStyles !== false) {
    try {
      const styleTags = document.querySelectorAll('style');
      styleTags.forEach(tag => { extraStyles += tag.innerHTML + '\n'; });
    } catch { }
  }

  const html = buildPrintHtml(content, title, { ...options, extraStyles });

  // ── A4 pages: open as a normal browser tab so the user can preview + Ctrl+P / Save as PDF ──
  // The tab gets a real full-width viewport, so content lays out at proper A4 width.
  if (options?.page === 'A4') {
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    // Open as a normal new tab (no size constraints) — guaranteed full viewport
    const tab = window.open(blobUrl, '_blank');
    if (!tab) {
      // Popup blocked — fall back to iframe
      URL.revokeObjectURL(blobUrl);
      printViaIframe(html);
      return;
    }
    // Revoke blob URL after the tab loads (content is already loaded into memory)
    setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch {} }, 10_000);
    return;
  }

  // ── A5 / auto pages: use hidden iframe (works reliably at small sizes) ──
  printViaIframe(html);
};

/** Internal: print via hidden iframe (used for A5 and as fallback) */
const printViaIframe = (html: string) => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    document.body.removeChild(iframe);
    alert('تعذر بدء الطباعة على هذا الجهاز');
    return;
  }

  const removeIframe = () => {
    try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch { }
  };

  iframeWindow.document.open();
  iframeWindow.document.write(html);
  iframeWindow.document.close();

  let didTrigger = false;
  const triggerPrint = () => {
    if (didTrigger) return;
    didTrigger = true;
    try {
      iframeWindow.focus();
      const maybePromise = (iframeWindow as any).print?.();
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.catch(() => undefined);
      }
    } catch { return; }
    iframeWindow.addEventListener('afterprint', removeIframe, { once: true });
    setTimeout(removeIframe, 60_000);
  };

  iframeWindow.addEventListener('load', () => setTimeout(triggerPrint, 80), { once: true });
  setTimeout(triggerPrint, 350);
};

/**
 * تنسيق التاريخ للطباعة
 */
export const formatDateForPrint = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * تنسيق الوقت فقط
 */
export const formatTimeForPrint = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('ar-EG-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * تنسيق التاريخ فقط
 */
export const formatDateOnly = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/**
 * printBlobDocument — مخصص لطباعة المستندات المستقلة (عقود، ضمانات، ...).
 *
 * يعمل بثلاث خطوات:
 *  1. استخراج <style> من HTML المُصيَّر ووضعه في <head>
 *  2. تحويل HTML كاملاً إلى Blob URL (معزول تماماً عن التطبيق)
 *  3. فتح popup window حقيقية (ليست tab) — لا يتدخل فيها SPA router أبداً
 */
export const printBlobDocument = (renderedHtml: string, title: string = 'طباعة'): void => {
  // Hoist component <style> to <head>
  const { hoistedCss, bodyHtml } = hoistComponentStyles(renderedHtml);

  const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; }
    @media print {
      html, body { width: 100%; height: auto; overflow: visible; }
    }
  </style>
  ${hoistedCss ? `<style>\n${hoistedCss}\n</style>` : ''}
</head>
<body>
${bodyHtml}
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      window.focus();
      window.print();
      window.addEventListener('afterprint', function() { window.close(); });
      setTimeout(function() { window.close(); }, 120000);
    }, 250);
  });
<\/script>
</body>
</html>`;

  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  // Use popup window (not tab) — SPA router NEVER intercepts popup windows
  const sw = window.screen.availWidth;
  const sh = window.screen.availHeight;
  const pw = Math.min(900, sw);
  const ph = Math.min(1100, sh);
  const left = Math.floor((sw - pw) / 2);
  const top = Math.floor((sh - ph) / 2);

  const popup = window.open(
    blobUrl,
    'azta_doc_print',
    `width=${pw},height=${ph},left=${left},top=${top},toolbar=1,menubar=1,scrollbars=1,resizable=1`
  );

  // Revoke blob URL once the popup loads (browser already has the content)
  const revoke = () => URL.revokeObjectURL(blobUrl);
  if (popup) {
    popup.addEventListener('load', revoke, { once: true });
  }
  // Fallback revoke after 30s even if popup is blocked
  setTimeout(revoke, 30_000);
};
