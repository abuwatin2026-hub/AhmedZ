import bcrypt from 'bcryptjs';

/**
 * عدد جولات التشفير - كلما زاد العدد، زادت الأمان ولكن زاد الوقت
 * 12 rounds توازن جيد بين الأمان والأداء
 */
const SALT_ROUNDS = 12;

/**
 * تشفير كلمة المرور باستخدام bcrypt
 * @param password كلمة المرور النصية
 * @returns كلمة المرور المشفرة (hash)
 */
export const hashPassword = async (password: string): Promise<string> => {
    if (!password || password.trim().length === 0) {
        throw new Error('كلمة المرور مطلوبة');
    }

    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        return hash;
    } catch (error) {
        console.error('Error hashing password:', error);
        throw new Error('فشل تشفير كلمة المرور');
    }
};

/**
 * التحقق من صحة كلمة المرور
 * @param password كلمة المرور النصية المدخلة
 * @param hash كلمة المرور المشفرة المخزنة
 * @returns true إذا كانت كلمة المرور صحيحة
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
    if (!password || !hash) {
        return false;
    }

    try {
        const isValid = await bcrypt.compare(password, hash);
        return isValid;
    } catch (error) {
        console.error('Error verifying password:', error);
        return false;
    }
};

/**
 * التحقق من قوة كلمة المرور
 * @param password كلمة المرور للتحقق منها
 * @returns رسالة خطأ إذا كانت كلمة المرور ضعيفة، أو null إذا كانت قوية
 */
export const validatePasswordStrength = (password: string): string | null => {
    if (!password) {
        return 'كلمة المرور مطلوبة';
    }

    if (password.length < 6) {
        return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    }

    if (password.length > 128) {
        return 'كلمة المرور طويلة جداً';
    }

    // يمكن إضافة متطلبات إضافية هنا
    // مثل: أحرف كبيرة، أرقام، رموز خاصة

    return null;
};

/**
 * التحقق من أن الـ hash هو bcrypt hash صالح
 * @param hash النص للتحقق منه
 * @returns true إذا كان bcrypt hash صالح
 */
export const isBcryptHash = (hash: string): boolean => {
    // bcrypt hashes تبدأ بـ $2a$, $2b$, أو $2y$
    return /^\$2[aby]\$\d{2}\$.{53}$/.test(hash);
};

/**
 * التحقق من أن الـ hash هو SHA-256 hash قديم
 * @param hash النص للتحقق منه
 * @returns true إذا كان SHA-256 hash (base64)
 */
export const isLegacySHA256Hash = (hash: string): boolean => {
    // SHA-256 base64 encoded عادة 44 حرف
    return /^[A-Za-z0-9+/]{43}=$/.test(hash);
};
