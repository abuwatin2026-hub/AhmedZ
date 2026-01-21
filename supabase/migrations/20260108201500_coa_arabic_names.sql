insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values
  ('1010', 'النقدية', 'asset', 'debit'),
  ('1020', 'البنك', 'asset', 'debit'),
  ('1200', 'الذمم المدينة', 'asset', 'debit'),
  ('2010', 'الذمم الدائنة', 'liability', 'credit'),
  ('2020', 'ضريبة القيمة المضافة المستحقة', 'liability', 'credit'),
  ('2050', 'ودائع العملاء', 'liability', 'credit'),
  ('4010', 'إيرادات المبيعات', 'income', 'credit'),
  ('4020', 'إيرادات التوصيل', 'income', 'credit'),
  ('4021', 'أرباح/زيادة المخزون', 'income', 'credit'),
  ('4025', 'خصومات المبيعات', 'income', 'debit'),
  ('4026', 'مرتجعات المبيعات', 'income', 'debit'),
  ('5010', 'تكلفة البضاعة المباعة', 'expense', 'debit'),
  ('5020', 'نقص المخزون', 'expense', 'debit'),
  ('1410', 'المخزون', 'asset', 'debit'),
  ('1420', 'ضريبة القيمة المضافة المستردة', 'asset', 'debit'),
  ('6100', 'المصروفات التشغيلية', 'expense', 'debit'),
  ('6110', 'زيادة/نقص الصندوق', 'expense', 'debit'),
  ('3000', 'الأرباح المبقاة', 'equity', 'credit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;
