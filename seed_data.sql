-- ملف: seed_data.sql
-- الوصف: ملء قاعدة البيانات بالبيانات الافتراضية (منتجات، إعلانات، إعدادات) لتطابق التطبيق المحلي

do $$
declare
  r record;
  id_type text;
begin
  if to_regclass('public.menu_items') is not null then
    select format_type(a.atttypid, a.atttypmod)
    into id_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'menu_items'
      and a.attname = 'id'
      and a.attnum > 0
      and not a.attisdropped;

    if id_type = 'uuid' then
      for r in
        select conrelid::regclass as tbl, conname
        from pg_constraint
        where contype = 'f'
          and confrelid = 'public.menu_items'::regclass
      loop
        execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
      end loop;

      for r in
        select conrelid::regclass as tbl, conname
        from pg_constraint
        where contype = 'p'
          and conrelid = 'public.menu_items'::regclass
      loop
        execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
      end loop;

      execute 'alter table public.menu_items alter column id type text using id::text';
      execute 'alter table public.menu_items add primary key (id)';
    end if;
  end if;

  if to_regclass('public.ads') is not null then
    select format_type(a.atttypid, a.atttypmod)
    into id_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ads'
      and a.attname = 'id'
      and a.attnum > 0
      and not a.attisdropped;

    if id_type = 'uuid' then
      for r in
        select conrelid::regclass as tbl, conname
        from pg_constraint
        where contype = 'p'
          and conrelid = 'public.ads'::regclass
      loop
        execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
      end loop;

      execute 'alter table public.ads alter column id type text using id::text';
      execute 'alter table public.ads add primary key (id)';
    end if;
  end if;
end $$;

-- 1. إضافة المنتجات الافتراضية (Menu Items)
insert into public.menu_items (id, data)
values
  ('1', '{
    "id": "1",
    "name": { "ar": "أرز بسمتي 10 كجم", "en": "Basmati Rice 10kg" },
    "description": { "ar": "أرز بسمتي بجودة ممتازة للتجزئة والجملة.", "en": "Premium basmati rice suitable for retail and wholesale." },
    "price": 14500,
    "imageUrl": "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%237FA99B%22/><stop offset=%221%22 stop-color=%22%232F5D62%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>",
    "category": "grocery",
    "rating": { "average": 4.8, "count": 156 },
    "isFeatured": true,
    "status": "active",
    "unitType": "piece",
    "availableStock": 25,
    "freshnessLevel": "good"
  }'),
  ('2', '{
    "id": "2",
    "name": { "ar": "سكر 50 كجم", "en": "Sugar 50kg" },
    "description": { "ar": "سكر للتجزئة والجملة مناسب للمتاجر.", "en": "Sugar suitable for retail and wholesale." },
    "price": 38000,
    "imageUrl": "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%23D4AF37%22/><stop offset=%221%22 stop-color=%22%23FFD700%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>",
    "category": "grocery",
    "rating": { "average": 4.9, "count": 203 },
    "isFeatured": true,
    "status": "active",
    "unitType": "piece",
    "availableStock": 18,
    "freshnessLevel": "good"
  }'),
  ('3', '{
    "id": "3",
    "name": { "ar": "زيت طبخ 4 لتر", "en": "Cooking Oil 4L" },
    "description": { "ar": "زيت طبخ مناسب للمطاعم والبيوت.", "en": "Cooking oil suitable for restaurants and households." },
    "price": 6800,
    "imageUrl": "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%231F3D42%22/><stop offset=%221%22 stop-color=%22%230F2020%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>",
    "category": "grocery",
    "rating": { "average": 4.7, "count": 142 },
    "isFeatured": true,
    "status": "active",
    "unitType": "piece",
    "availableStock": 20,
    "freshnessLevel": "good"
  }'),
  ('4', '{
    "id": "4",
    "name": { "ar": "حليب طويل الأجل", "en": "UHT Milk" },
    "description": { "ar": "حليب معبأ مناسب للتجزئة.", "en": "Packaged milk suitable for retail." },
    "price": 450,
    "imageUrl": "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%237FA99B%22/><stop offset=%221%22 stop-color=%22%23A8C5BA%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>",
    "category": "beverages",
    "rating": { "average": 4.6, "count": 128 },
    "isFeatured": false,
    "status": "active",
    "unitType": "piece",
    "availableStock": 30,
    "freshnessLevel": "fresh"
  }'),
  ('5', '{
    "id": "5",
    "name": { "ar": "سائل غسيل 5 لتر", "en": "Laundry Detergent 5L" },
    "description": { "ar": "تركيز عالي ورائحة ثابتة.", "en": "High concentration and long-lasting scent." },
    "price": 5200,
    "imageUrl": "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22600%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%23D4AF37%22/><stop offset=%221%22 stop-color=%22%23FFD700%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>",
    "category": "cleaning",
    "rating": { "average": 4.9, "count": 187 },
    "isFeatured": true,
    "status": "active",
    "unitType": "piece",
    "availableStock": 15,
    "freshnessLevel": "good"
  }')
on conflict (id) do nothing;

-- 2. إضافة الإعلانات الافتراضية (Ads)
insert into public.ads (id, status, display_order, data)
values
  ('ad1', 'active', 0, '{
    "id": "ad1",
    "title": { "ar": "مرحباً بك!", "en": "Welcome!" },
    "subtitle": { "ar": "مواد غذائية بالجملة والتجزئة", "en": "Groceries wholesale & retail" },
    "imageUrl": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgwIiBoZWlnaHQ9Ijc1MCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMkY1RDYyIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMUYzRDQyIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjM3NSIgcj0iMTQwIiBmaWxsPSIjQThDNUJBIi8+PHBhdGggZD0iTTIwMCAzMDBjODAgNTAgODAgMTUwIDAgMjAwIiBzdHJva2U9IiMyRjNFNDIiIHN0cm9rZS13aWR0aD0iOCIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==",
    "actionType": "none",
    "order": 0,
    "status": "active"
  }'),
  ('ad2', 'active', 1, '{
    "id": "ad2",
    "title": { "ar": "توصيل سريع لباب بيتك!", "en": "Fast delivery to your door!" },
    "subtitle": { "ar": "طلبك من المواد الغذائية يصلك بسرعة.", "en": "Your groceries arrive fast." },
    "imageUrl": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgwIiBoZWlnaHQ9Ijc1MCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjN0ZBOTlCIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjQThDNUJBIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNnKSIvPjwvc3ZnPg==",
    "actionType": "none",
    "order": 1,
    "status": "active"
  }'),
  ('ad3', 'active', 2, '{
    "id": "ad3",
    "title": { "ar": "استخدم كوبون SAVE10", "en": "Use coupon SAVE10" },
    "subtitle": { "ar": "خصم 10% على طلبك!", "en": "Get 10% off your order!" },
    "imageUrl": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgwIiBoZWlnaHQ9Ijc1MCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjRDRBRjM3Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjRkZENzAwIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNnKSIvPjwvc3ZnPg==",
    "actionType": "category",
    "actionTarget": "all",
    "order": 2,
    "status": "active"
  }')
on conflict (id) do nothing;

-- 3. إضافة إعدادات التطبيق الافتراضية (App Settings)
insert into public.app_settings (id, data)
values
  ('app', '{
    "cafeteriaName": { "ar": "مؤسسة أحمد زنقاح للتجارة والتوكيلات", "en": "Ahmed Zangah Trading & Agencies Est" },
    "logoUrl": "/logo.jpg",
    "contactNumber": "967782681999",
    "address": "مأرب، اليمن",
    "paymentMethods": {
      "cash": true,
      "kuraimi": true,
      "network": true
    },
    "defaultLanguage": "ar",
    "deliverySettings": {
      "baseFee": 5.00,
      "freeDeliveryThreshold": 2000
    },
    "loyaltySettings": {
      "enabled": true,
      "pointsPerCurrencyUnit": 0.1,
      "currencyValuePerPoint": 1,
      "tiers": {
        "regular": { "name": { "ar": "عادي", "en": "Regular" }, "threshold": 0, "discountPercentage": 0 },
        "bronze": { "name": { "ar": "البرونزي", "en": "Bronze" }, "threshold": 1000, "discountPercentage": 2 },
        "silver": { "name": { "ar": "الفضي", "en": "Silver" }, "threshold": 5000, "discountPercentage": 5 },
        "gold": { "name": { "ar": "الذهبي", "en": "Gold" }, "threshold": 15000, "discountPercentage": 10 }
      },
      "referralRewardPoints": 100,
      "newUserReferralDiscount": {
        "type": "fixed",
        "value": 500
      }
    }
  }')
on conflict (id) do nothing;
