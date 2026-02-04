export const resolveErrorMessage = (error: unknown): string => {
  if (!error) return '';
  const anyErr = error as any;
  const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
  if (msg) return msg;
  const str = typeof error === 'string' ? error : '';
  return str;
};

export const isAbortLikeError = (error: unknown): boolean => {
  if (!error) return false;
  const anyErr = error as any;
  const name = typeof anyErr?.name === 'string' ? anyErr.name.toLowerCase() : '';
  if (name === 'aborterror') return true;
  const code = typeof anyErr?.code === 'string' ? anyErr.code.toLowerCase() : '';
  if (code === 'err_aborted') return true;
  const msg = resolveErrorMessage(error);
  const raw = msg.trim().toLowerCase();
  if (!raw) return false;
  return /(^|\b)(abort|aborted|aborterror)(\b|$)/i.test(raw) || raw.includes('err_aborted') || raw.includes('the user aborted') || raw.includes('request aborted') || raw.includes('canceled') || raw.includes('cancelled');
};

export const localizeError = (message: string): string => {
  const raw = message.trim().toLowerCase();
  if (!raw) return 'فشل العملية.';
  if (raw.includes('no api key found in request') || raw.includes('no `apikey` request header') || raw.includes('apikey request header')) {
    return 'مفتاح Supabase (apikey) غير موجود في الطلب. تأكد من ضبط VITE_SUPABASE_ANON_KEY في بيئة البناء ثم أعد النشر.';
  }
  if (raw === 'food_sale_requires_batch') return 'لا يمكن بيع صنف غذائي بدون تحديد دفعة.';
  if (raw === 'sale_out_requires_batch') return 'لا يمكن تنفيذ الخصم بدون تحديد دفعة.';
  if (raw === 'no_valid_batch') return 'NO_VALID_BATCH';
  if (raw === 'insufficient_batch_quantity') return 'INSUFFICIENT_BATCH_QUANTITY';
  if (raw === 'batch_not_released') return 'BATCH_NOT_RELEASED';
  if (raw === 'below_cost_not_allowed') return 'BELOW_COST_NOT_ALLOWED';
  if (raw === 'selling_below_cost_not_allowed') return 'BELOW_COST_NOT_ALLOWED';
  if (raw === 'no_valid_batch_available') return 'لا توجد دفعة صالحة (غير منتهية) لهذا الصنف.';
  if (raw.includes('insufficient_fefo_batch_stock_for_item_')) return 'لا توجد كمية كافية في الدفعات الصالحة (FEFO) لهذا الصنف.';
  if (raw.includes('insufficient_reserved_batch_stock_for_item_')) return 'لا توجد كمية محجوزة كافية لهذا الصنف في الدفعات.';
  if (raw.includes('insufficient_batch_stock_for_item_')) return 'لا توجد كمية كافية لهذا الصنف في الدفعات.';
  if (raw.includes('batch not released or recalled')) return 'تم رفض البيع لأن الدفعة غير مجازة أو عليها استدعاء.';
  if (
    /^batch_expired$/i.test(message.trim()) ||
    /^batch_blocked$/i.test(message.trim()) ||
    /insufficient reserved stock for item/i.test(message) ||
    /insufficient batch remaining/i.test(message) ||
    /insufficient non-reserved batch remaining/i.test(message)
  ) {
    return message;
  }
  if (raw === 'unknown' || raw === 'unknown error' || raw === 'an unknown error has occurred') return 'حدث خطأ غير متوقع.';
  if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('request timed out')) return 'انتهت مهلة الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
  if (raw.includes('there is no unique or exclusion constraint matching the on conflict specification')) {
    return 'حدث خطأ داخلي أثناء تسجيل العملية المالية. يرجى تحديث إعدادات قاعدة البيانات (المايجريشن) ثم إعادة المحاولة.';
  }
  if (raw.includes('cash method requires an open cash shift')) {
    return 'يجب فتح وردية نقدية صالحة قبل تسجيل دفعة نقدية لهذا الطلب.';
  }
  if (raw.includes('payments_cash_requires_shift') || (raw.includes('violates check constraint') && raw.includes('cash_requires_shift'))) {
    return 'لا يمكن تسجيل دفعة نقدية بدون وردية نقدية مفتوحة. افتح وردية ثم أعد المحاولة.';
  }
  if (raw.includes('posting already exists for this source')) {
    return 'تم ترحيل هذا القيد سابقًا. إذا أردت الإلغاء، يجب إنشاء قيد عكسي (Reversal).';
  }
  if (raw.includes('could not find the function') && raw.includes('close_cash_shift_v2')) {
    return 'تعذر العثور على دالة إغلاق الوردية في قاعدة البيانات. حدّث النظام ثم أعد المحاولة.';
  }
  if ((raw.includes('is not unique') || raw.includes('not unique')) && raw.includes('close_cash_shift_v2')) {
    return 'تعذر إغلاق الوردية بسبب تعارض في نسخة دالة الإغلاق بقاعدة البيانات. تم إصلاحه في تحديث القاعدة—حدّث الصفحة ثم أعد المحاولة.';
  }
  if (
    raw.includes('closed period') ||
    raw.includes('period is closed') ||
    (raw.includes('accounting') && raw.includes('period') && (raw.includes('closed') || raw.includes('locked'))) ||
    raw.includes('date within closed period')
  ) {
    return 'تم رفض العملية بسبب إقفال فترة محاسبية. لا يمكن إدراج أو تعديل قيود بتاريخ داخل فترة مقفلة.';
  }
  if (raw.includes('paid amount exceeds total')) {
    return 'المبلغ المدفوع يتجاوز إجمالي الطلب. تحقق من الدفعات السابقة أو من قيمة الطلب.';
  }
  if (raw.includes('purchase order total is zero')) {
    return 'لا يمكن تسجيل دفعة لأمر شراء إجماليه صفر. حدّث الأمر أو تحقق من بنوده ثم أعد المحاولة.';
  }
  if (raw.includes('purchase order already fully paid')) {
    return 'أمر الشراء مسدد بالكامل ولا يمكن إضافة دفعة جديدة.';
  }
  if (raw.includes('purchase_orders_amounts_check')) {
    return 'تعذر حفظ الدفعة لأن المبلغ المدفوع أصبح يتجاوز إجمالي أمر الشراء.';
  }
  if (raw.includes('fx rate missing for currency')) {
    const m = message.match(/fx rate missing for currency\s+([A-Z]{3})/i);
    const c = m && m[1] ? m[1].toUpperCase() : '';
    return c ? `لا يوجد سعر صرف للعملة ${c} لليوم. أضف سعر الصرف ثم أعد المحاولة.` : 'لا يوجد سعر صرف للعملة لليوم. أضف سعر الصرف ثم أعد المحاولة.';
  }
  if (raw.includes('p_purchase_order_id is required')) {
    return 'معرف أمر الشراء مطلوب.';
  }
  if (raw.includes('p_order_id is required')) {
    return 'معرف الطلب مطلوب.';
  }
  if (raw.includes('p_payment_id is required')) {
    return 'معرف الدفعة مطلوب.';
  }
  if (raw.includes('source_id is required') || raw.includes('source_type is required')) {
    return 'تعذر ترحيل القيد المحاسبي بسبب نقص بيانات المصدر. حدّث الصفحة ثم أعد المحاولة.';
  }
  if (raw.includes('order not found')) {
    return 'تعذر العثور على هذا الطلب في قاعدة البيانات. حدّث الصفحة وتأكد أن الطلب لم يُحذف.';
  }
  if (raw.includes('invalid amount')) {
    return 'قيمة الدفعة غير صحيحة. تحقق من المبلغ وأعد المحاولة.';
  }
  if (raw.includes('operator does not exist') && raw.includes('->>')) return 'خطأ في قاعدة البيانات أثناء حفظ البيانات. تم إصلاحه في آخر تحديث للقاعدة، حدّث المايجريشن ثم أعد المحاولة.';
  if (raw.includes('invalid jwt') || raw.includes('jwt')) return 'انتهت الجلسة أو بيانات الدخول غير صالحة. أعد تسجيل الدخول ثم حاول مرة أخرى.';
  if (!/(^|\b)(abort|aborted|aborterror)(\b|$)/i.test(raw) && !raw.includes('err_aborted') && /(failed to fetch|fetch failed|network\s?error|networkerror)/i.test(raw)) {
    return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
  }
  if (
    raw.includes('forbidden') ||
    raw.includes('not authorized') ||
    raw.includes('permission denied') ||
    raw.includes('permission') ||
    raw.includes('rls') ||
    raw.includes('row level security') ||
    raw.includes('row-level security') ||
    raw.includes('violates row-level security') ||
    raw.includes('policy')
  ) return 'ليس لديك صلاحية تنفيذ هذا الإجراء.';
  if (
    raw.includes('duplicate key value') ||
    raw.includes('violates unique constraint') ||
    raw.includes('already exists') ||
    raw.includes('duplicate')
  ) return 'البيانات المدخلة موجودة مسبقًا.';
  if (raw.includes('missing') || raw.includes('required')) return 'الحقول المطلوبة ناقصة.';
  return message;
};

export const localizeSupabaseError = (error: unknown): string => {
  if (isAbortLikeError(error)) return '';
  const anyErr = error as any;
  const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
  if (code === '23505') {
    const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
    const details = typeof anyErr?.details === 'string' ? anyErr.details : '';
    const hint = typeof anyErr?.hint === 'string' ? anyErr.hint : '';
    const combined = `${msg}\n${details}\n${hint}`.toLowerCase();
    if (combined.includes('uq_purchase_receipts_idempotency') || combined.includes('purchase_receipts') && combined.includes('idempotency')) {
      return 'تم تنفيذ هذا الاستلام مسبقًا (طلب مكرر).';
    }
    if (
      combined.includes('purchase_receipt_items') ||
      combined.includes('receipt_id') && combined.includes('item_id') && combined.includes('purchase')
    ) {
      return 'تم إرسال نفس الصنف أكثر من مرة ضمن نفس الاستلام. حدّث الصفحة ثم أعد المحاولة.';
    }
    if (combined.includes('approval_requests')) {
      return 'يوجد طلب موافقة مطابق سابقًا. افتح قسم الموافقات وتحقق من الحالة.';
    }
    return 'البيانات المدخلة موجودة مسبقًا.';
  }
  const message = resolveErrorMessage(error);
  return localizeError(message || '');
};
