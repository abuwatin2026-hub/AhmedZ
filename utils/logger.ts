/**
 * نظام Logging محترف للتطبيق
 */

export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: string;
    data?: any;
    error?: {
        message: string;
        stack?: string;
        name?: string;
    };
}

class Logger {
    private static instance: Logger;
    private context?: string;
    private isDevelopment: boolean;

    private constructor(context?: string) {
        this.context = context;
        this.isDevelopment = import.meta.env.DEV;
    }

    static getInstance(context?: string): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(context);
        }
        return Logger.instance;
    }

    /**
     * إنشاء logger جديد مع context محدد
     */
    static create(context: string): Logger {
        return new Logger(context);
    }

    private formatMessage(level: LogLevel, message: string, data?: any): LogEntry {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context: this.context,
        };

        if (data) {
            if (data instanceof Error) {
                entry.error = {
                    message: data.message,
                    stack: data.stack,
                    name: data.name,
                };
            } else {
                entry.data = data;
            }
        }

        return entry;
    }

    private log(level: LogLevel, message: string, data?: any): void {
        const entry = this.formatMessage(level, message, data);

        // في بيئة التطوير: طباعة في Console
        if (this.isDevelopment) {
            const consoleMethod = level === LogLevel.ERROR ? 'error' :
                level === LogLevel.WARN ? 'warn' :
                    level === LogLevel.DEBUG ? 'debug' : 'log';

            const prefix = this.context ? `[${this.context}]` : '';
            console[consoleMethod](`${prefix} ${message}`, data || '');
        }

        // في بيئة الإنتاج: إرسال إلى خدمة خارجية
        if (!this.isDevelopment && level !== LogLevel.DEBUG) {
            this.sendToExternalService(entry);
        }

        // حفظ الأخطاء الحرجة محلياً
        if (level === LogLevel.ERROR) {
            this.saveErrorLocally(entry);
        }
    }

    /**
     * إرسال السجل إلى خدمة خارجية (Sentry, LogRocket, etc.)
     */
    private sendToExternalService(entry: LogEntry): void {
        void entry;
        // TODO: تكامل مع خدمة تتبع الأخطاء
        // مثال:
        // if (window.Sentry) {
        //   if (entry.level === LogLevel.ERROR && entry.error) {
        //     Sentry.captureException(new Error(entry.error.message), {
        //       contexts: { log: entry }
        //     });
        //   } else {
        //     Sentry.captureMessage(entry.message, entry.level);
        //   }
        // }
    }

    /**
     * حفظ الأخطاء محلياً للمراجعة
     */
    private saveErrorLocally(entry: LogEntry): void {
        try {
            const errors = this.getLocalErrors();
            errors.push(entry);

            // الاحتفاظ بآخر 50 خطأ فقط
            const recentErrors = errors.slice(-50);
            localStorage.setItem('app_errors', JSON.stringify(recentErrors));
        } catch (e) {
            // تجاهل أخطاء localStorage
        }
    }

    /**
     * الحصول على الأخطاء المحفوظة محلياً
     */
    private getLocalErrors(): LogEntry[] {
        try {
            const stored = localStorage.getItem('app_errors');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    /**
     * تسجيل رسالة معلوماتية
     */
    info(message: string, data?: any): void {
        this.log(LogLevel.INFO, message, data);
    }

    /**
     * تسجيل رسالة تحذير
     */
    warn(message: string, data?: any): void {
        this.log(LogLevel.WARN, message, data);
    }

    /**
     * تسجيل خطأ
     */
    error(message: string, error?: Error | any): void {
        this.log(LogLevel.ERROR, message, error);
    }

    /**
     * تسجيل رسالة debug (فقط في التطوير)
     */
    debug(message: string, data?: any): void {
        if (this.isDevelopment) {
            this.log(LogLevel.DEBUG, message, data);
        }
    }

    /**
     * الحصول على جميع الأخطاء المحفوظة
     */
    static getStoredErrors(): LogEntry[] {
        try {
            const stored = localStorage.getItem('app_errors');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    /**
     * مسح الأخطاء المحفوظة
     */
    static clearStoredErrors(): void {
        try {
            localStorage.removeItem('app_errors');
        } catch {
            // تجاهل
        }
    }

    /**
     * تسجيل حدث مستخدم (للتحليلات)
     */
    static trackEvent(eventName: string, properties?: Record<string, any>): void {
        // في الإنتاج: إرسال إلى خدمة التحليلات
        if (!import.meta.env.DEV) {
            // TODO: تكامل مع Google Analytics, Mixpanel, etc.
            // analytics.track(eventName, properties);
        }

        if (import.meta.env.DEV) {
            console.log(`📊 Event: ${eventName}`, properties);
        }
    }

    /**
     * تسجيل أداء العملية
     */
    static measurePerformance(label: string, startTime: number): void {
        const duration = Date.now() - startTime;

        if (import.meta.env.DEV) {
            console.log(`⏱️ Performance: ${label} took ${duration}ms`);
        }

        // في الإنتاج: إرسال إلى خدمة مراقبة الأداء
        if (!import.meta.env.DEV && duration > 1000) {
            // تسجيل العمليات البطيئة فقط
            Logger.getInstance().warn(`Slow operation: ${label}`, { duration });
        }
    }
}

// تصدير instance افتراضي
export const logger = Logger.getInstance();

// تصدير دوال مساعدة
export const createLogger = (context: string) => Logger.create(context);
export const trackEvent = Logger.trackEvent;
export const measurePerformance = Logger.measurePerformance;
export const getStoredErrors = Logger.getStoredErrors;
export const clearStoredErrors = Logger.clearStoredErrors;

export default Logger;
