/**
 * نظام تشفير البيانات الحساسة
 * يستخدم Web Crypto API لتشفير وفك تشفير البيانات
 */

import { createLogger } from './logger';

const logger = createLogger('Encryption');

// مفتاح التشفير - في الإنتاج يجب تخزينه بشكل آمن
// يمكن توليده من كلمة مرور المستخدم أو من خادم آمن
const ENCRYPTION_KEY_STORAGE = 'app_encryption_key';

const normalizeBase64 = (input: string): string => {
    let s = (input || '').trim();
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    return s;
};

const base64ToBytes = (input: string): Uint8Array | null => {
    const normalized = normalizeBase64(input);
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return null;
    try {
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
};
/**
 * توليد مفتاح تشفير جديد
 */
async function generateEncryptionKey(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true, // extractable
        ['encrypt', 'decrypt']
    );
}

/**
 * تصدير مفتاح التشفير كـ base64
 */
async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

/**
 * استيراد مفتاح التشفير من base64
 */
async function importKey(keyData: string): Promise<CryptoKey> {
    const bytes = base64ToBytes(keyData);
    if (!bytes || bytes.length === 0) {
        throw new Error('مفتاح تشفير غير صالح');
    }

    return await crypto.subtle.importKey(
        'raw',
        bytes.buffer as ArrayBuffer,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * الحصول على مفتاح التشفير أو إنشاء واحد جديد
 */
async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    try {
        // محاولة الحصول على المفتاح المخزن
        const storedKey = localStorage.getItem(ENCRYPTION_KEY_STORAGE);
        if (storedKey) {
            return await importKey(storedKey);
        }

        // إنشاء مفتاح جديد
        const newKey = await generateEncryptionKey();
        const exported = await exportKey(newKey);
        localStorage.setItem(ENCRYPTION_KEY_STORAGE, exported);

        logger.info('New encryption key generated');
        return newKey;
    } catch (error) {
        logger.error('Error getting encryption key', error as Error);
        throw new Error('فشل الحصول على مفتاح التشفير');
    }
}

/**
 * تشفير نص
 * @param plaintext النص الأصلي
 * @returns النص المشفر مع IV (base64)
 */
export async function encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';

    try {
        const key = await getOrCreateEncryptionKey();

        // توليد IV عشوائي
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // تشفير البيانات
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            key,
            data
        );

        // دمج IV مع البيانات المشفرة
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        // تحويل إلى base64
        return btoa(String.fromCharCode(...combined));
    } catch (error) {
        logger.error('Encryption failed', error as Error);
        throw new Error('فشل تشفير البيانات');
    }
}

/**
 * فك تشفير نص
 * @param ciphertext النص المشفر (base64)
 * @returns النص الأصلي
 */
export async function decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';

    try {
        const key = await getOrCreateEncryptionKey();

        const combined = base64ToBytes(ciphertext);
        if (!combined || combined.length < 13) {
            return ciphertext;
        }

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        let decrypted: ArrayBuffer;
        try {
            decrypted = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                },
                key,
                data
            );
        } catch (e) {
            return ciphertext;
        }

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        return ciphertext;
    }
}

/**
 * تشفير كائن JSON
 */
export async function encryptObject<T>(obj: T): Promise<string> {
    const json = JSON.stringify(obj);
    return await encrypt(json);
}

/**
 * فك تشفير كائن JSON
 */
export async function decryptObject<T>(ciphertext: string): Promise<T> {
    const json = await decrypt(ciphertext);
    return JSON.parse(json) as T;
}

/**
 * تشفير حقل معين في كائن
 */
export async function encryptField<T extends Record<string, any>>(
    obj: T,
    field: keyof T
): Promise<T> {
    if (!obj[field]) return obj;

    const encrypted = await encrypt(String(obj[field]));
    return {
        ...obj,
        [field]: encrypted,
    };
}

/**
 * فك تشفير حقل معين في كائن
 */
export async function decryptField<T extends Record<string, any>>(
    obj: T,
    field: keyof T
): Promise<T> {
    if (!obj[field]) return obj;

    try {
        const decrypted = await decrypt(String(obj[field]));
        return {
            ...obj,
            [field]: decrypted,
        };
    } catch (error) {
        // إذا فشل فك التشفير، قد تكون البيانات غير مشفرة أصلاً
        logger.warn(`Failed to decrypt field ${String(field)}, returning as-is`);
        return obj;
    }
}

/**
 * تشفير حقول متعددة في كائن
 */
export async function encryptFields<T extends Record<string, any>>(
    obj: T,
    fields: (keyof T)[]
): Promise<T> {
    let result = { ...obj };

    for (const field of fields) {
        if (result[field]) {
            result = await encryptField(result, field);
        }
    }

    return result;
}

/**
 * فك تشفير حقول متعددة في كائن
 */
export async function decryptFields<T extends Record<string, any>>(
    obj: T,
    fields: (keyof T)[]
): Promise<T> {
    let result = { ...obj };

    for (const field of fields) {
        if (result[field]) {
            result = await decryptField(result, field);
        }
    }

    return result;
}

/**
 * التحقق من أن النص مشفر
 */
export function isEncrypted(text: string): boolean {
    if (!text) return false;

    try {
        const bytes = base64ToBytes(text);
        return !!bytes && bytes.length > 16;
    } catch {
        return false;
    }
}

/**
 * إعادة توليد مفتاح التشفير (سيجعل جميع البيانات المشفرة غير قابلة للقراءة)
 */
export async function regenerateEncryptionKey(): Promise<void> {
    logger.warn('Regenerating encryption key - all encrypted data will be lost');
    localStorage.removeItem(ENCRYPTION_KEY_STORAGE);
    await getOrCreateEncryptionKey();
}
