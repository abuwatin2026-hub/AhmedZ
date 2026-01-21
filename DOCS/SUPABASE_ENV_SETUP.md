# ضبط متغيرات بيئة وظائف Supabase

## المتطلبات

- رابط المشروع: `https://<ref>.supabase.co`
- مفاتيح المشروع:
  - `anon` → للاستخدام مع واجهة العميل والتحقق من الجلسة
  - `service_role` → للاستخدام داخل وظائف الحافة فقط
- قائمة النطاقات المسموحة للوصول إلى الدوال: مثال `https://yourdomain.com,https://staging.yourdomain.com`

## التنصيب عبر Supabase CLI

من داخل مجلد المشروع `d:\caty`، نفّذ:

```powershell
supabase link --project-ref bvkxohvxzhwqsmbgowwd
```

ثم استخدم السكربت:

```powershell
./supabase/setup-secrets.ps1 -ApiUrl https://<ref>.supabase.co -AnonKey <anon> -ServiceRoleKey <service_role> -AllowedOrigins "https://localhost:5174,https://yourdomain.com"
```

سيتم:

- تعيين `CATY_SUPABASE_URL`, `CATY_SUPABASE_ANON_KEY`, `CATY_SUPABASE_SERVICE_ROLE_KEY`, `CATY_ALLOWED_ORIGINS` في بيئة وظائف الحافة.
- نشر الدوال: `create-admin-user`, `reset-admin-password`, `delete-admin-user`.

## ملاحظات

- لا تستخدم `service_role` خارج وظائف الحافة.
- يمكن تعديل `CATY_ALLOWED_ORIGINS` لاحقاً لضبط الوصول.
