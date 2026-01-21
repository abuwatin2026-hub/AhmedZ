export async function loadSampleQatData(): Promise<void> {
  throw new Error('تم تعطيل تحميل البيانات التجريبية وإزالة أي إنشاء بيانات محلية.');
}

export async function clearAllData(): Promise<void> {
  throw new Error('تم تعطيل مسح/إعادة تحميل البيانات التجريبية.');
}

export async function reloadSampleData(): Promise<void> {
  throw new Error('تم تعطيل إعادة تحميل البيانات التجريبية.');
}
