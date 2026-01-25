# AZTA — تشغيل النظام للإنتاج

## الهوية التقنية المعتمدة

- Merchant Key: AZTA
- Slug: ahmed-zenkah-trading
- Android applicationId / package: com.azta.ahmedzenkahtrading
- Production URL: https://ahmedzangah.pages.dev/#/
- Supabase Project URL: https://twcjjisnxmfpseksqnhb.supabase.co

## إعدادات الويب (Vite)

- يتم تحميل اتصال Supabase من:
  - VITE_SUPABASE_URL
  - VITE_SUPABASE_ANON_KEY
- رابط تنزيل APK في واجهة التحميل يعتمد على:
  - VITE_APP_PUBLIC_ORIGIN
  - VITE_APP_ANDROID_APK_FILENAME

القيمة الموصى بها في الإنتاج:

- VITE_APP_PUBLIC_ORIGIN=https://ahmedzangah.pages.dev/

## إعداد أسرار وظائف Supabase

- استخدم السكربت: [setup-secrets.ps1](file:///d:/AhmedZ/supabase/setup-secrets.ps1)
- الأسرار المطلوبة داخل بيئة وظائف Supabase:
  - AZTA_SUPABASE_URL
  - AZTA_SUPABASE_ANON_KEY
  - AZTA_SUPABASE_SERVICE_ROLE_KEY
  - AZTA_ALLOWED_ORIGINS

## بناء الويب للإنتاج

```powershell
npm install
npm run typecheck
npm run build
```

## مزامنة كاباسيتور (Android)

```powershell
npm run sync
```

## إصدار APK موقّع (Release)

- مفاتيح التوقيع تُقرأ من متغيرات البيئة التالية:
  - AZTA_RELEASE_STORE_FILE
  - AZTA_RELEASE_STORE_PASSWORD
  - AZTA_RELEASE_KEY_ALIAS
  - AZTA_RELEASE_KEY_PASSWORD

```powershell
cd android
.\gradlew assembleRelease
```

## نشر ملف APK للتحميل من الويب

```powershell
npm run apk:publish
```
