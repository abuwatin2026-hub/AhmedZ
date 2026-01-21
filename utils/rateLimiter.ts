/**
 * نظام Rate Limiting للحماية من هجمات Brute Force
 */

interface LoginAttempt {
    count: number;
    firstAttemptAt: number;
    lockedUntil?: number;
}

export class RateLimiter {
    private attempts: Map<string, LoginAttempt>;
    private readonly maxAttempts: number;
    private readonly windowMs: number; // نافذة زمنية لحساب المحاولات
    private readonly lockoutDuration: number;

    constructor(
        maxAttempts: number = 5,
        windowMs: number = 15 * 60 * 1000, // 15 دقيقة
        lockoutDuration: number = 15 * 60 * 1000 // 15 دقيقة
    ) {
        this.attempts = new Map();
        this.maxAttempts = maxAttempts;
        this.windowMs = windowMs;
        this.lockoutDuration = lockoutDuration;
    }

    /**
     * التحقق من إمكانية المحاولة
     * @param identifier معرف فريد (مثل: اسم المستخدم أو IP)
     * @returns معلومات عن إمكانية المحاولة
     */
    checkLimit(identifier: string): {
        allowed: boolean;
        remainingAttempts?: number;
        remainingLockoutTime?: number;
        message?: string;
    } {
        const now = Date.now();
        const attempt = this.attempts.get(identifier);

        // إذا لم توجد محاولات سابقة
        if (!attempt) {
            return {
                allowed: true,
                remainingAttempts: this.maxAttempts,
            };
        }

        // التحقق من القفل
        if (attempt.lockedUntil && now < attempt.lockedUntil) {
            const remainingMs = attempt.lockedUntil - now;
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            return {
                allowed: false,
                remainingLockoutTime: remainingMs,
                message: `تم قفل الحساب مؤقتاً. حاول مرة أخرى بعد ${remainingMinutes} دقيقة.`,
            };
        }

        // إذا انتهت النافذة الزمنية، إعادة تعيين
        if (now - attempt.firstAttemptAt > this.windowMs) {
            this.attempts.delete(identifier);
            return {
                allowed: true,
                remainingAttempts: this.maxAttempts,
            };
        }

        // التحقق من عدد المحاولات
        const remainingAttempts = this.maxAttempts - attempt.count;
        if (remainingAttempts <= 0) {
            // قفل الحساب
            attempt.lockedUntil = now + this.lockoutDuration;
            this.attempts.set(identifier, attempt);

            const lockoutMinutes = Math.ceil(this.lockoutDuration / 60000);
            return {
                allowed: false,
                remainingLockoutTime: this.lockoutDuration,
                message: `تم تجاوز الحد الأقصى للمحاولات. تم قفل الحساب لمدة ${lockoutMinutes} دقيقة.`,
            };
        }

        return {
            allowed: true,
            remainingAttempts,
        };
    }

    /**
     * تسجيل محاولة تسجيل دخول
     * @param identifier معرف فريد
     * @param success هل نجحت المحاولة؟
     */
    recordAttempt(identifier: string, success: boolean): void {
        const now = Date.now();

        if (success) {
            // إذا نجحت المحاولة، حذف السجل
            this.attempts.delete(identifier);
            return;
        }

        // تسجيل محاولة فاشلة
        const attempt = this.attempts.get(identifier);

        if (!attempt) {
            this.attempts.set(identifier, {
                count: 1,
                firstAttemptAt: now,
            });
        } else {
            // التحقق من النافذة الزمنية
            if (now - attempt.firstAttemptAt > this.windowMs) {
                // نافذة جديدة
                this.attempts.set(identifier, {
                    count: 1,
                    firstAttemptAt: now,
                });
            } else {
                // زيادة العداد
                attempt.count++;
                this.attempts.set(identifier, attempt);
            }
        }
    }

    /**
     * إعادة تعيين المحاولات لمعرف معين
     * @param identifier معرف فريد
     */
    reset(identifier: string): void {
        this.attempts.delete(identifier);
    }

    /**
     * مسح جميع المحاولات (للصيانة)
     */
    clearAll(): void {
        this.attempts.clear();
    }

    /**
     * مسح المحاولات المنتهية الصلاحية (للصيانة)
     */
    cleanup(): void {
        const now = Date.now();
        for (const [identifier, attempt] of this.attempts.entries()) {
            // حذف المحاولات القديمة
            if (now - attempt.firstAttemptAt > this.windowMs * 2) {
                this.attempts.delete(identifier);
            }
            // حذف الأقفال المنتهية
            if (attempt.lockedUntil && now > attempt.lockedUntil) {
                this.attempts.delete(identifier);
            }
        }
    }

    /**
     * الحصول على إحصائيات
     */
    getStats(): {
        totalTracked: number;
        currentlyLocked: number;
    } {
        const now = Date.now();
        let locked = 0;

        for (const attempt of this.attempts.values()) {
            if (attempt.lockedUntil && now < attempt.lockedUntil) {
                locked++;
            }
        }

        return {
            totalTracked: this.attempts.size,
            currentlyLocked: locked,
        };
    }
}

// إنشاء instances عامة
export const adminLoginLimiter = new RateLimiter(5, 15 * 60 * 1000, 15 * 60 * 1000);
export const userLoginLimiter = new RateLimiter(5, 15 * 60 * 1000, 15 * 60 * 1000);

// تنظيف دوري كل ساعة
if (typeof window !== 'undefined') {
    setInterval(() => {
        adminLoginLimiter.cleanup();
        userLoginLimiter.cleanup();
    }, 60 * 60 * 1000);
}
