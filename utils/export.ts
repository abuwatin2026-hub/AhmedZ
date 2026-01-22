import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export const sharePdf = async (
    elementId: string,
    title: string,
    filename: string,
    options?: {
        pageSize?: [number, number];
        scale?: number;
        unit?: 'mm' | 'px';
        headerTitle?: string;
        headerSubtitle?: string;
        footerText?: string;
        headerHeight?: number;
        footerHeight?: number;
        logoUrl?: string;
    }
): Promise<boolean> => {
    const element = document.getElementById(elementId);
    if (!element) return false;

    try {
        const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
            import('jspdf'),
            import('html2canvas'),
        ]);
        const prepareLogoData = async (src?: string): Promise<{ data: string; format: 'PNG' | 'JPEG'; width: number; height: number } | null> => {
            if (!src) return null;
            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });
                const maxH = 32;
                const ratio = loaded.width > 0 && loaded.height > 0 ? loaded.width / loaded.height : 1;
                const targetH = maxH;
                const targetW = Math.max(1, Math.round(targetH * ratio));
                const canvasEl = document.createElement('canvas');
                canvasEl.width = targetW;
                canvasEl.height = targetH;
                const ctx = canvasEl.getContext('2d');
                if (!ctx) return null;
                ctx.clearRect(0, 0, targetW, targetH);
                ctx.drawImage(loaded, 0, 0, targetW, targetH);
                const data = canvasEl.toDataURL('image/png');
                return { data, format: 'PNG', width: targetW, height: targetH };
            } catch {
                return null;
            }
        };
        const logo = await prepareLogoData(options?.logoUrl);
        const isMobile = /Mobi|Android/i.test(navigator.userAgent) || Capacitor.isNativePlatform();
        const scale = options?.scale ?? (isMobile ? 1.5 : 2);
        const usePx = options?.unit ? options.unit === 'px' : isMobile;
        const headerTitle = options?.headerTitle ?? '';
        const headerSubtitle = options?.headerSubtitle ?? title;
        const footerText = options?.footerText ?? `تم الإنشاء: ${new Date().toLocaleString('en-US')}`;
        const canvas = await html2canvas(element, { scale });
        const imgData = canvas.toDataURL('image/png');

        let dataUri = '';
        if (usePx) {
            const headerPx = Math.max(0, options?.headerHeight ?? 40);
            const footerPx = Math.max(0, options?.footerHeight ?? 24);
            const pageSize = options?.pageSize || [canvas.width, canvas.height + headerPx + footerPx];
            const orientation = pageSize[0] > pageSize[1] ? 'l' : 'p';
            const pdf = new jsPDF({ orientation, unit: 'px', format: pageSize });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            let headerTop = 8;
            if (logo) {
                const lw = Math.min(logo.width, Math.round(pageWidth * 0.18));
                const lh = logo.height;
                const ly = Math.min(headerPx - 10, headerTop);
                pdf.addImage(logo.data, logo.format, 12, ly, lw, lh);
            }
            const titleY = Math.min(18, headerPx - 14);
            const subtitleY = Math.min(32, headerPx - 6);
            if (headerTitle) {
                pdf.setFontSize(14);
                pdf.text(headerTitle, pageWidth / 2, titleY, { align: 'center' as any });
            }
            if (headerSubtitle) {
                pdf.setFontSize(11);
                pdf.text(headerSubtitle, pageWidth / 2, subtitleY, { align: 'center' as any });
            }
            pdf.addImage(imgData, 'PNG', 0, headerPx, pageWidth, pageHeight - headerPx - footerPx);
            pdf.setFontSize(10);
            pdf.text(footerText, pageWidth / 2, pageHeight - 8, { align: 'center' as any });
            dataUri = pdf.output('datauristring');
        } else {
            const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const headerMm = Math.max(0, options?.headerHeight ?? 10);
            const footerMm = Math.max(0, options?.footerHeight ?? 8);
            const contentHeightMm = Math.max(0.1, pageHeight - headerMm - footerMm);
            const imgWidth = pageWidth;

            const imgDataPxWidth = canvas.width;
            const imgDataPxHeight = canvas.height;

            const sliceCanvas = document.createElement('canvas');
            const sliceContext = sliceCanvas.getContext('2d');
            if (!sliceContext) throw new Error('Failed to initialize canvas context');
            sliceCanvas.width = imgDataPxWidth;

            const mmPerPx = pageWidth / imgDataPxWidth;
            const pageHeightPx = contentHeightMm / mmPerPx;
            const totalPages = Math.max(1, Math.ceil(imgDataPxHeight / pageHeightPx));
            let currentPage = 1;

            let offsetPx = 0;
            while (offsetPx < imgDataPxHeight) {
                const sliceHeightPx = Math.min(imgDataPxHeight - offsetPx, pageHeightPx);
                sliceCanvas.height = sliceHeightPx;
                sliceContext.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                sliceContext.drawImage(canvas, 0, offsetPx, sliceCanvas.width, sliceHeightPx, 0, 0, sliceCanvas.width, sliceCanvas.height);
                const sliceData = sliceCanvas.toDataURL('image/png');
                const leftPad = 8;
                const titleYmm = Math.min(6, headerMm - 4);
                const subtitleYmm = Math.min(10, headerMm - 1);
                if (logo) {
                    const mmRatio = mmPerPx;
                    const lwMm = Math.min(pageWidth * 0.18, logo.width * mmRatio);
                    const lhMm = logo.height * mmRatio;
                    pdf.addImage(logo.data, logo.format, leftPad, Math.max(2, titleYmm - 4), lwMm, lhMm);
                }
                if (headerTitle) {
                    pdf.setFontSize(12);
                    pdf.text(headerTitle, pageWidth / 2, titleYmm, { align: 'center' as any });
                }
                if (headerSubtitle) {
                    pdf.setFontSize(10);
                    pdf.text(headerSubtitle, pageWidth / 2, subtitleYmm, { align: 'center' as any });
                }
                pdf.addImage(sliceData, 'PNG', 0, headerMm, imgWidth, (sliceHeightPx * mmPerPx));
                pdf.setFontSize(9);
                const pageLabel = `الصفحة ${currentPage} من ${totalPages}`;
                pdf.text(`${footerText} • ${pageLabel}`, pageWidth / 2, pageHeight - 4, { align: 'center' as any });
                offsetPx += sliceHeightPx;
                currentPage += 1;
                if (offsetPx < imgDataPxHeight) pdf.addPage();
            }

            dataUri = pdf.output('datauristring');
        }

        if (Capacitor.isNativePlatform()) {
            try {
                const perms = await Filesystem.checkPermissions();
                if (perms.publicStorage !== 'granted') {
                    await Filesystem.requestPermissions();
                }
            } catch {}

            const base64Data = dataUri.split(',')[1];
            const targetPath = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
            const result = await Filesystem.writeFile({
                path: targetPath,
                data: base64Data,
                directory: Directory.Documents,
            });

            await Share.share({
                title: title,
                text: `${title}.pdf`,
                url: result.uri,
                dialogTitle: `Share ${title}`
            });
        } else {
            const link = document.createElement('a');
            link.href = dataUri;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        return true;
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('Error sharing PDF:', error);
        }
        return false;
    }
};


export const exportToCsv = async (headers: string[], rows: (string | number)[][], filename: string): Promise<boolean> => {
    try {
        const toCell = (value: string | number) => {
            const raw = String(value ?? '');
            const escaped = raw.replace(/"/g, '""');
            return `"${escaped}"`;
        };

        const csvContent = [
            headers.map(toCell).join(','),
            ...rows.map(row => row.map(toCell).join(','))
        ].join('\n');

        if (Capacitor.isNativePlatform()) {
            // Ensure storage permissions are granted before writing the file
            try {
                const perms = await Filesystem.checkPermissions();
                if (perms.publicStorage !== 'granted') {
                    await Filesystem.requestPermissions();
                }
            } catch {}

            const result = await Filesystem.writeFile({
                path: filename,
                data: csvContent,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });

            // This assumes the user wants to be prompted to share/save after creation
            await Share.share({
                title: 'Exported Report',
                url: result.uri,
            });
        } else {
             // Web fallback: download
            const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        return true;
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('Error exporting to CSV:', error);
        }
        return false;
    }
};

export const exportToXlsx = async (
    headers: string[],
    rows: (string | number)[][],
    filename: string,
    options?: {
        sheetName?: string;
        autoFilter?: boolean;
        columnWidths?: number[];
        numberFormat?: string;
        integerFormat?: string;
        sanitizeNumbers?: boolean;
        currencyColumns?: number[];
        currencyFormat?: string;
    }
): Promise<boolean> => {
    try {
        const mod: any = await import('exceljs');
        const ExcelJS: any = mod?.default ?? mod;
        const shouldSanitize = options?.sanitizeNumbers ?? true;
        const sanitizedRows = shouldSanitize
            ? rows.map(row =>
                row.map(v => {
                    if (typeof v === 'number') return v;
                    const s = String(v ?? '').trim();
                    if (/^-?\d+(\.\d+)?$/.test(s)) {
                        const n = Number(s);
                        if (Number.isFinite(n)) return n;
                    }
                    return v;
                })
            )
            : rows;
        const data: (string | number)[][] = [headers, ...sanitizedRows];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(options?.sheetName || 'Report');
        worksheet.addRow(headers);
        for (const row of sanitizedRows) worksheet.addRow(row);

        const colCount = headers.length;
        const rowCount = data.length;
        const defaultNumFmt = options?.numberFormat || '#,##0.00';
        const defaultIntFmt = options?.integerFormat || '#,##0';
        for (let r = 2; r <= rowCount; r++) {
            const row = worksheet.getRow(r);
            for (let c = 1; c <= colCount; c++) {
                const cell = row.getCell(c);
                const v = cell.value;
                if (typeof v === 'number') {
                    cell.numFmt = Number.isInteger(v) ? defaultIntFmt : defaultNumFmt;
                }
            }
        }
        if (options?.currencyColumns && options.currencyColumns.length) {
            const curFmt = options.currencyFormat || '#,##0.00';
            const set = new Set(options.currencyColumns.map(n => Math.max(0, Math.floor(n))));
            for (let r = 2; r <= rowCount; r++) {
                const row = worksheet.getRow(r);
                for (const c0 of set) {
                    const c = c0 + 1;
                    if (c < 1 || c > colCount) continue;
                    const cell = row.getCell(c);
                    const v = cell.value;
                    if (typeof v === 'number') {
                        cell.numFmt = curFmt;
                    }
                }
            }
        }
        if (options?.autoFilter ?? true) {
            worksheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: Math.max(1, rowCount), column: Math.max(1, colCount) },
            };
        }
        if (options?.columnWidths && options.columnWidths.length) {
            for (let i = 0; i < colCount; i++) {
                const w = options.columnWidths[i];
                if (typeof w === 'number' && Number.isFinite(w)) {
                    worksheet.getColumn(i + 1).width = Math.max(6, w);
                }
            }
        } else {
            for (let c = 0; c < colCount; c++) {
                let maxLen = String(headers[c] || '').length;
                for (let r = 1; r < rowCount; r++) {
                    const v = data[r][c];
                    const len = typeof v === 'number' ? 12 : String(v ?? '').length;
                    if (len > maxLen) maxLen = len;
                }
                const width = Math.min(40, Math.max(8, Math.round(maxLen * 1.1)));
                worksheet.getColumn(c + 1).width = width;
            }
        }

        const toBase64 = (bytes: Uint8Array) => {
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            return btoa(binary);
        };

        const buildBytes = async (): Promise<Uint8Array> => {
            const out: any = await workbook.xlsx.writeBuffer();
            if (out instanceof ArrayBuffer) return new Uint8Array(out);
            if (out instanceof Uint8Array) return out;
            return new Uint8Array(out);
        };

        if (Capacitor.isNativePlatform()) {
            try {
                const perms = await Filesystem.checkPermissions();
                if (perms.publicStorage !== 'granted') {
                    await Filesystem.requestPermissions();
                }
            } catch {}

            const wbBase64 = toBase64(await buildBytes());
            const targetPath = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
            const result = await Filesystem.writeFile({
                path: targetPath,
                data: wbBase64,
                directory: Directory.Documents,
            });
            await Share.share({
                title: 'Exported Report',
                url: result.uri,
            });
        } else {
            const bytes = await buildBytes();
            const safeBytes = new Uint8Array(bytes);
            const blob = new Blob([safeBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
        return true;
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('Error exporting to XLSX:', error);
        }
        return false;
    }
};
