# ملفات SQL (مهم)

المصدر المعتمد لمخطط قاعدة البيانات هو ملفات الهجرات داخل:

- supabase/migrations

أي ملفات SQL في جذر المشروع كانت تُستخدم للتجارب أو الإصلاحات اليدوية وقد تتعارض مع المخطط الحالي أو سياسات RLS.

**الملفات الموصى بتشغيلها**

- [20251227000000_init.sql](file:///d:/AhmedZ/supabase/migrations/20251227000000_init.sql)
- [20251231000000_atomic_stock_rpc.sql](file:///d:/AhmedZ/supabase/migrations/20251231000000_atomic_stock_rpc.sql)
- [20260127100500_force_rls_accounting.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127100500_force_rls_accounting.sql)

**ملفات مؤرشفة (لا تُشغّل إلا عند الحاجة ومع معرفة أثرها)**

تم نقل سكربتات الإصلاح اليدوية إلى هذا المجلد للتوثيق ومنع تشغيلها بالخطأ.

