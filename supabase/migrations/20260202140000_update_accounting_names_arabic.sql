-- Update accounting account names to Arabic
-- This migration ensures all Chart of Accounts entries use Arabic names

insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
values
  ('1010', 'النقدية', 'asset', 'debit', true),
  ('1020', 'البنك', 'asset', 'debit', true),
  ('1200', 'الذمم المدينة', 'asset', 'debit', true),
  ('1410', 'المخزون', 'asset', 'debit', true),
  ('1420', 'ضريبة القيمة المضافة المستردة', 'asset', 'debit', true),
  ('2010', 'الذمم الدائنة', 'liability', 'credit', true),
  ('2020', 'ضريبة القيمة المضافة المستحقة', 'liability', 'credit', true),
  ('2050', 'ودائع العملاء', 'liability', 'credit', true),
  ('3000', 'الأرباح المبقاة', 'equity', 'credit', true),
  ('4010', 'إيرادات المبيعات', 'income', 'credit', true),
  ('4020', 'إيرادات التوصيل', 'income', 'credit', true),
  ('4021', 'أرباح/زيادة المخزون', 'income', 'credit', true),
  ('4025', 'خصومات المبيعات', 'income', 'debit', true),
  ('4026', 'مرتجعات المبيعات', 'income', 'debit', true),
  ('5010', 'تكلفة البضاعة المباعة', 'expense', 'debit', true),
  ('5020', 'نقص المخزون', 'expense', 'debit', true),
  ('6100', 'المصروفات التشغيلية', 'expense', 'debit', true),
  ('6110', 'زيادة/نقص الصندوق', 'expense', 'debit', true)
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;
