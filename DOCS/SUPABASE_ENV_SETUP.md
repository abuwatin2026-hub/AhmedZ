# ضبط متغيرات بيئة وظائف Supabase

## المتطلبات

- رابط المشروع: `https://twcjjisnxmfpseksqnhb.supabase.co`
- مفاتيح المشروع:
  - `anon` → للاستخدام مع واجهة العميل والتحقق من الجلسة
  - `service_role` → للاستخدام داخل وظائف الحافة فقط
- قائمة النطاقات المسموحة للوصول إلى الدوال: مثال `https://ahmedzangah.pages.dev`

## التنصيب عبر Supabase CLI

من داخل مجلد المشروع `d:\AhmedZ`، نفّذ:

```powershell
supabase link --project-ref twcjjisnxmfpseksqnhb
```

ثم استخدم السكربت:

```powershell
./supabase/setup-secrets.ps1 -ApiUrl https://twcjjisnxmfpseksqnhb.supabase.co -AnonKey $env:AZTA_SUPABASE_ANON_KEY -ServiceRoleKey $env:AZTA_SUPABASE_SERVICE_ROLE_KEY -AllowedOrigins "http://localhost:5174,https://ahmedzangah.pages.dev" -PasskeyRpId "ahmedzangah.pages.dev" -PasskeyOrigin "https://ahmedzangah.pages.dev"
```

سيتم:

- تعيين `AZTA_SUPABASE_URL`, `AZTA_SUPABASE_ANON_KEY`, `AZTA_SUPABASE_SERVICE_ROLE_KEY`, `AZTA_ALLOWED_ORIGINS`, `AZTA_PASSKEY_RP_ID`, `AZTA_PASSKEY_ORIGIN`, `AZTA_PASSKEY_RP_NAME` في بيئة وظائف الحافة.
- نشر الدوال: `create-admin-user`, `create-admin-customer`, `reset-admin-password`, `delete-admin-user`, `passkey-register-options`, `passkey-register-verify`.

## ملاحظات

- لا تستخدم `service_role` خارج وظائف الحافة.
- يمكن تعديل `AZTA_ALLOWED_ORIGINS` لاحقاً لضبط الوصول.
- يجب أن تتطابق قيم `AZTA_PASSKEY_RP_ID` و `AZTA_PASSKEY_ORIGIN` مع دومين التطبيق الفعلي.
