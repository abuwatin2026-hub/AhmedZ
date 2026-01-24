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
  if (raw.includes('paid amount exceeds total')) {
    return 'المبلغ المدفوع يتجاوز إجمالي الطلب. تحقق من الدفعات السابقة أو من قيمة الطلب.';
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
  if (raw.includes('duplicate') || raw.includes('already')) return 'البيانات المدخلة موجودة مسبقًا.';
  if (raw.includes('missing') || raw.includes('required')) return 'الحقول المطلوبة ناقصة.';
  return message;
};

export const localizeSupabaseError = (error: unknown): string => {
  if (isAbortLikeError(error)) return '';
  const message = resolveErrorMessage(error);
  return localizeError(message || '');
};
