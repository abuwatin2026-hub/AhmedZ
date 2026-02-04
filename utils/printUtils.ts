/**
 * Print Utilities
 * مكتبة مساعدة للطباعة
 */

/**
 * فتح نافذة الطباعة
 */
export const buildPrintHtml = (content: string, title: string = 'طباعة', options?: { page?: 'A4' | 'auto' }) => {
    const page = options?.page || 'A4';
    const pageCss = page === 'A4'
        ? `
          @page {
            size: A4;
            margin: 10mm;
          }
        `
        : `
          @page {
            margin: 10mm;
          }
        `;
    return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Cairo', 'Arial', sans-serif;
          direction: rtl;
          padding: 20px;
        }
        
        @media print {
          body {
            padding: 0;
          }
          
          .no-print {
            display: none !important;
          }
          ${pageCss}
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
        }
        
        th, td {
          padding: 8px;
          text-align: right;
          border: 1px solid #ddd;
        }
        
        th {
          background-color: #f3f4f6;
          font-weight: bold;
        }
        
        .text-center {
          text-align: center;
        }
        
        .text-left {
          text-align: left;
        }
        
        .font-bold {
          font-weight: bold;
        }
        
        .mb-2 {
          margin-bottom: 8px;
        }
        
        .mb-4 {
          margin-bottom: 16px;
        }
        
        .mt-4 {
          margin-top: 16px;
        }
        
        .border-b {
          border-bottom: 2px solid #000;
          padding-bottom: 10px;
          margin-bottom: 10px;
        }
        
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        
        .header h1 {
          font-size: 24px;
          margin-bottom: 5px;
        }
        
        .header p {
          color: #666;
          font-size: 14px;
        }
        
        .info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
        }
        
        .total-row {
          background-color: #f9fafb;
          font-weight: bold;
          font-size: 16px;
        }
      </style>
    </head>
    <body>
      ${content}
    </body>
    </html>
  `;
};

export const printContent = (content: string, title: string = 'طباعة', options?: { page?: 'A4' | 'auto' }) => {
    const html = buildPrintHtml(content, title, options);

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

    const printWindow = window.open('about:blank', '_blank');
    if (printWindow) {
        openAndPrint(printWindow, () => {
            try { printWindow.close(); } catch {}
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
