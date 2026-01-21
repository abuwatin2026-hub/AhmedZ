import { z } from 'zod';

/**
 * مخططات التحقق من صحة البيانات باستخدام Zod
 */

// رقم الهاتف اليمني
export const phoneSchema = z.string()
    .trim()
    .regex(/^(77|73|71|70)\d{7}$/, {
        message: 'رقم الهاتف غير صحيح. يجب أن يبدأ بـ 77، 73، 71، أو 70 ويتكون من 9 أرقام',
    });

// اسم العميل
export const customerNameSchema = z.string()
    .trim()
    .min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل')
    .max(50, 'الاسم طويل جداً (الحد الأقصى 50 حرف)')
    .regex(/^[\u0600-\u06FFa-zA-Z\s]+$/, {
        message: 'الاسم يجب أن يحتوي على أحرف عربية أو إنجليزية فقط',
    });

// العنوان
export const addressSchema = z.string()
    .trim()
    .min(10, 'العنوان قصير جداً (10 أحرف على الأقل)')
    .max(200, 'العنوان طويل جداً (الحد الأقصى 200 حرف)');

// البريد الإلكتروني
export const emailSchema = z.string()
    .trim()
    .email('البريد الإلكتروني غير صحيح')
    .max(100, 'البريد الإلكتروني طويل جداً');

// اسم المستخدم
export const usernameSchema = z.string()
    .trim()
    .min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل')
    .max(50, 'اسم المستخدم طويل جداً (الحد الأقصى 50 حرف)');

// كلمة المرور
export const passwordSchema = z.string()
    .min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
    .max(128, 'كلمة المرور طويلة جداً');

// كلمة مرور قوية (اختياري للاستخدام المستقبلي)
export const strongPasswordSchema = z.string()
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128, 'كلمة المرور طويلة جداً')
    .regex(/[a-z]/, 'كلمة المرور يجب أن تحتوي على حرف صغير واحد على الأقل')
    .regex(/[A-Z]/, 'كلمة المرور يجب أن تحتوي على حرف كبير واحد على الأقل')
    .regex(/[0-9]/, 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل');

// ملاحظات الطلب
export const orderNotesSchema = z.string()
    .trim()
    .max(500, 'الملاحظات طويلة جداً (الحد الأقصى 500 حرف)')
    .optional();

// تعليمات التوصيل
export const deliveryInstructionsSchema = z.string()
    .trim()
    .max(300, 'تعليمات التوصيل طويلة جداً (الحد الأقصى 300 حرف)')
    .optional();

// الكمية
export const quantitySchema = z.number()
    .int('الكمية يجب أن تكون رقم صحيح')
    .positive('الكمية يجب أن تكون أكبر من صفر')
    .max(1000, 'الكمية كبيرة جداً');

// الوزن (بالكيلوغرام)
export const weightSchema = z.number()
    .positive('الوزن يجب أن يكون أكبر من صفر')
    .max(100, 'الوزن كبير جداً');

// السعر
export const priceSchema = z.number()
    .nonnegative('السعر لا يمكن أن يكون سالباً')
    .max(1000000, 'السعر كبير جداً');

// رمز الكوبون
export const couponCodeSchema = z.string()
    .trim()
    .min(3, 'رمز الكوبون قصير جداً')
    .max(20, 'رمز الكوبون طويل جداً')
    .regex(/^[A-Z0-9]+$/, {
        message: 'رمز الكوبون يجب أن يحتوي على أحرف كبيرة وأرقام فقط',
    });

// رقم مرجعي للدفع
export const paymentReferenceSchema = z.string()
    .trim()
    .min(5, 'الرقم المرجعي قصير جداً')
    .max(50, 'الرقم المرجعي طويل جداً')
    .regex(/^[A-Z0-9-]+$/i, {
        message: 'الرقم المرجعي يحتوي على أحرف غير صالحة',
    });

// مخطط الطلب الكامل
export const orderSchema = z.object({
    customerName: customerNameSchema,
    phoneNumber: phoneSchema,
    address: addressSchema,
    notes: orderNotesSchema,
    deliveryInstructions: deliveryInstructionsSchema,
    paymentMethod: z.enum(['cash', 'kuraimi', 'network'], { message: 'طريقة الدفع غير صالحة' }),
    paymentProof: z.string().optional(),
    paymentProofType: z.enum(['image', 'ref_number']).optional(),
    paymentNetworkRecipient: z.object({
        recipientId: z.string(),
        recipientName: z.string(),
        recipientPhoneNumber: phoneSchema,
    }).optional(),
}).superRefine((data, ctx) => {
    if (data.paymentMethod === 'network' && !data.paymentNetworkRecipient) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'يرجى اختيار المستلم.',
            path: ['paymentNetworkRecipient'],
        });
    }
});

// مخطط تسجيل مستخدم جديد
export const userRegistrationSchema = z.object({
    fullName: customerNameSchema,
    phoneNumber: phoneSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema,
    referralCode: z.string().trim().max(20).optional(),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
});

// مخطط تسجيل دخول
export const loginSchema = z.object({
    identifier: z.string().trim().min(1, 'اسم المستخدم أو رقم الهاتف مطلوب'),
    password: passwordSchema,
});

// مخطط تغيير كلمة المرور
export const changePasswordSchema = z.object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
    confirmNewPassword: passwordSchema,
}).refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'كلمتا المرور الجديدتين غير متطابقتين',
    path: ['confirmNewPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
    message: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن القديمة',
    path: ['newPassword'],
});

// مخطط إنشاء منتج
export const menuItemSchema = z.object({
    name: z.object({
        ar: z.string().trim().min(2, 'الاسم بالعربية قصير جداً').max(100),
        en: z.string().trim().max(100).optional(),
    }),
    description: z.object({
        ar: z.string().trim().min(10, 'الوصف قصير جداً').max(500),
        en: z.string().trim().max(500).optional(),
    }),
    price: priceSchema,
    category: z.string().trim().min(1, 'التصنيف مطلوب'),
    imageUrl: z.string().url('رابط الصورة غير صحيح').optional(),
});

// دالة مساعدة لتنسيق أخطاء Zod
export const formatZodError = (error: z.ZodError): string => {
    return error.issues.map(issue => issue.message).join(', ');
};

// دالة مساعدة للتحقق من البيانات وإرجاع نتيجة واضحة
export const validateData = <T>(
    schema: z.ZodSchema<T>,
    data: unknown
): { success: true; data: T } | { success: false; error: string } => {
    try {
        const validated = schema.parse(data);
        return { success: true, data: validated };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: formatZodError(error) };
        }
        return { success: false, error: 'خطأ في التحقق من البيانات' };
    }
};
