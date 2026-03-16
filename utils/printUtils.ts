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
export const buildPrintHtml = (content: string, title: string = 'طباعة', options?: { page?: 'A5' | 'auto', extraStyles?: string, includeAppStyles?: boolean }) => {
  const page = options?.page || 'A5';
  const pageCss = page === 'A5'
    ? `@page { size: A5; margin: 0; }`
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
        body { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; padding: 0; margin: 0; }
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

export const printContent = (content: string, title: string = 'طباعة', options?: { page?: 'A5' | 'auto', includeAppStyles?: boolean }) => {
  // By default, inject app styles for backward compatibility.
  // Pass includeAppStyles: false for self-contained document components (contracts, guarantees, etc.)
  // that already have their own complete CSS and must not be polluted by Tailwind/app overrides.
  let extraStyles = '';
  if (options?.includeAppStyles !== false) {
    try {
      const styleTags = document.querySelectorAll('style');
      styleTags.forEach(tag => { extraStyles += tag.innerHTML + '\n'; });
    } catch { }
  }

  const html = buildPrintHtml(content, title, { ...options, extraStyles });

  const openAndPrint = (targetWindow: Window, cleanup: () => void) => {
    targetWindow.document.open();
    targetWindow.document.write(html);
    targetWindow.document.close();

    let didTrigger = false;
    const triggerPrint = () => {
      if (didTrigger) return;
      didTrigger = true;
      try {
        targetWindow.focus();
        const maybePromise = (targetWindow as any).print?.();
        if (maybePromise && typeof maybePromise.then === 'function' && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => undefined);
        }
      } catch {
        return;
      }

      targetWindow.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 60000);
    };

    targetWindow.addEventListener('load', () => setTimeout(triggerPrint, 50), { once: true });
    setTimeout(triggerPrint, 250);
  };

  const printWindow = window.open(
    'about:blank',
    '_blank',
    `noopener,noreferrer,width=${window.screen.availWidth},height=${window.screen.availHeight}`
  );
  if (printWindow) {
    openAndPrint(printWindow, () => {
      try { printWindow.close(); } catch { }
    });
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    document.body.removeChild(iframe);
    alert('تعذر بدء الطباعة على هذا الجهاز');
    return;
  }

  const removeIframe = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  iframeWindow.addEventListener('afterprint', removeIframe, { once: true });
  setTimeout(removeIframe, 60000);

  openAndPrint(iframeWindow, removeIframe);
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
