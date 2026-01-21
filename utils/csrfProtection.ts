/**
 * نظام CSRF Protection
 * يحمي من هجمات Cross-Site Request Forgery
 */

import { createLogger } from './logger';

const logger = createLogger('CSRF');

const CSRF_TOKEN_KEY = 'csrf_token';
const CSRF_TOKEN_EXPIRY_KEY = 'csrf_token_expiry';
const TOKEN_VALIDITY_DURATION = 60 * 60 * 1000; // ساعة واحدة

/**
 * توليد CSRF token عشوائي
 */
function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * الحصول على CSRF token الحالي أو إنشاء واحد جديد
 */
export function getCSRFToken(): string {
    const now = Date.now();
    const storedToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
    const expiryStr = sessionStorage.getItem(CSRF_TOKEN_EXPIRY_KEY);

    // التحقق من صلاحية Token الحالي
    if (storedToken && expiryStr) {
        const expiry = parseInt(expiryStr, 10);
        if (now < expiry) {
            return storedToken;
        }
    }

    // إنشاء token جديد
    const newToken = generateToken();
    const expiry = now + TOKEN_VALIDITY_DURATION;

    sessionStorage.setItem(CSRF_TOKEN_KEY, newToken);
    sessionStorage.setItem(CSRF_TOKEN_EXPIRY_KEY, expiry.toString());

    logger.debug('New CSRF token generated');
    return newToken;
}

/**
 * التحقق من صحة CSRF token
 */
export function validateCSRFToken(token: string): boolean {
    const storedToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
    const expiryStr = sessionStorage.getItem(CSRF_TOKEN_EXPIRY_KEY);

    if (!storedToken || !expiryStr) {
        logger.warn('CSRF validation failed - no token found');
        return false;
    }

    const expiry = parseInt(expiryStr, 10);
    const now = Date.now();

    if (now >= expiry) {
        logger.warn('CSRF validation failed - token expired');
        return false;
    }

    if (token !== storedToken) {
        logger.warn('CSRF validation failed - token mismatch');
        return false;
    }

    return true;
}

/**
 * تحديث CSRF token (بعد استخدامه)
 */
export function refreshCSRFToken(): string {
    sessionStorage.removeItem(CSRF_TOKEN_KEY);
    sessionStorage.removeItem(CSRF_TOKEN_EXPIRY_KEY);
    return getCSRFToken();
}

/**
 * حذف CSRF token
 */
export function clearCSRFToken(): void {
    sessionStorage.removeItem(CSRF_TOKEN_KEY);
    sessionStorage.removeItem(CSRF_TOKEN_EXPIRY_KEY);
    logger.debug('CSRF token cleared');
}

/**
 * إضافة CSRF token إلى FormData
 */
export function addCSRFTokenToFormData(formData: FormData): FormData {
    const token = getCSRFToken();
    formData.append('csrf_token', token);
    return formData;
}

/**
 * إضافة CSRF token إلى كائن
 */
export function addCSRFTokenToObject<T extends Record<string, any>>(obj: T): T & { csrf_token: string } {
    const token = getCSRFToken();
    return {
        ...obj,
        csrf_token: token,
    };
}

/**
 * Hook لاستخدام CSRF token في React
 */
export function useCSRFToken(): {
    token: string;
    validate: (token: string) => boolean;
    refresh: () => string;
} {
    return {
        token: getCSRFToken(),
        validate: validateCSRFToken,
        refresh: refreshCSRFToken,
    };
}

/**
 * Middleware للتحقق من CSRF token في الطلبات
 */
export function csrfMiddleware(handler: () => void): () => void {
    return () => {
        const token = getCSRFToken();
        if (!token) {
            logger.error('CSRF token missing');
            throw new Error('CSRF token is required');
        }
        handler();
    };
}
