# ترقية آمنة بدون فقد البيانات

هذه الدليل يضمن تنفيذ تحديثات قاعدة البيانات دون فقدان أي بيانات مدخلة من قبل المستخدمين.

## مبادئ أساسية
- لا تستخدم أمر "supabase db reset" إلا في بيئة تطوير تجريبية وخارج بيانات حقيقية.
- في كل تحديث، استخدم "supabase db migrate" فقط لتطبيق الهجرات تدريجياً دون إسقاط الجداول.
- نفّذ نسخة احتياطية قبل أي ترقية، واستعدها عند الحاجة.

## أوامر موصى بها (Windows PowerShell)
1) أخذ نسخة احتياطية:
```
docker exec <CONTAINER_DB> pg_dump -U postgres -d postgres -f /tmp/backup.sql
docker cp <CONTAINER_DB>:/tmp/backup.sql .\\backup_$(Get-Date -Format yyyyMMdd_HHmmss).sql
```
بدّل `<CONTAINER_DB>` باسم حاوية قاعدة البيانات (مثل supabase_db_*).

2) تطبيق الهجرات دون فقد البيانات:
```
npx supabase db migrate --local
```

3) استعادة النسخة إذا لزم:
```
docker cp .\\backup_YYYYMMDD_HHMMSS.sql <CONTAINER_DB>:/tmp/restore.sql
docker exec <CONTAINER_DB> psql -U postgres -d postgres -f /tmp/restore.sql
```

## لماذا "reset" خطير؟
- أمر "reset" يعيد إنشاء القاعدة من الصفر ويطبق الهجرات والـ seed؛ هذا يُسقط كل البيانات المخزنة.
- لذلك لا يُستخدم في الترقيات أو التحديثات الاعتيادية مطلقاً.

## ملاحظات
- ملف seed فارغ الآن، لذا "migrate" لن ينشئ بيانات افتراضية ولن يغيّر بياناتك.
- الهجرات مكتوبة لتكون idempotent وتضيف/تعدل البنية فقط، دون حذف بيانات المستخدم.

## توصية تشغيل
- أضف مهمة نسخ احتياطي مجدولة قبل أي تشغيل لأوامر الترقية.
- راقب المخرجات لأي أخطاء، ولا تلجأ لـ "reset" لحلها؛ أصلح الهجرة المحددة.
