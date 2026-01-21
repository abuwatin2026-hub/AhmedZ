/**
 * Image Utilities
 * مكتبة مساعدة لمعالجة الصور: ضغط، تحويل، والتحقق
 */

export interface ImageCompressionOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number; // 0-1
    outputFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * ضغط الصورة وتحويلها إلى Base64
 */
export const compressImage = async (
    file: File,
    options: ImageCompressionOptions = {}
): Promise<string> => {
    const {
        maxWidth = 800,
        maxHeight = 800,
        quality = 0.8,
        outputFormat = 'image/jpeg'
    } = options;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // حساب الأبعاد الجديدة مع الحفاظ على النسبة
                if (width > height) {
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('تعذر تجهيز مساحة الرسم للصورة.'));
                    return;
                }

                // رسم الصورة على Canvas
                ctx.drawImage(img, 0, 0, width, height);

                // تحويل إلى Base64
                const base64 = canvas.toDataURL(outputFormat, quality);
                resolve(base64);
            };

            img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
            img.src = e.target?.result as string;
        };

        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(file);
    });
};

/**
 * التحقق من نوع الملف
 */
export const isValidImageType = (file: File): boolean => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    return validTypes.includes(file.type);
};

/**
 * التحقق من حجم الملف (بالميجابايت)
 */
export const isValidImageSize = (file: File, maxSizeMB: number = 5): boolean => {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    return file.size <= maxSizeBytes;
};

/**
 * الحصول على حجم الملف بصيغة قابلة للقراءة
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * قراءة الصورة كـ Base64 بدون ضغط
 */
export const readImageAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            resolve(e.target?.result as string);
        };

        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(file);
    });
};

/**
 * استخراج معلومات الصورة
 */
export const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };

            img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
            img.src = e.target?.result as string;
        };

        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(file);
    });
};
