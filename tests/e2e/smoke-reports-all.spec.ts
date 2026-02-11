import { test, expect, type Page } from '@playwright/test';
import { adminStorageStatePath } from './global-setup';
import { runSmokeSql } from './utils/runSmokeSql';

test.use({ storageState: adminStorageStatePath });

const expectHeading = async (page: Page, name: string) => {
  const inMain = page.getByRole('main').getByRole('heading', { name });
  try {
    await expect(inMain).toBeVisible({ timeout: 60_000 });
    return;
  } catch {
    const any = page.getByRole('heading', { name }).first();
    await expect(any).toBeVisible({ timeout: 60_000 });
  }
};

test.describe.serial('اختبارات دخان: التقارير بكل أنواعها (UI + DB)', () => {
  test.beforeAll(async () => {
    runSmokeSql({
      sqlRelPath: 'supabase/smoke/smoke_local_uom_purchases_import_sales_party_ledger.sql',
      okToken: 'LOCAL_SCENARIO_SMOKE_OK',
      reportNamePrefix: 'ui-reports-seed',
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/admin/profile');
    await expect(page.getByRole('heading', { name: 'الملف الشخصي للمدير' })).toBeVisible({ timeout: 60_000 });
  });

  test('فتح صفحات التقارير تعمل بدون تعطل', async ({ page }) => {
    const pages: Array<{ url: string; heading: string }> = [
      { url: '/#/admin/reports', heading: 'مركز التقارير' },
      { url: '/#/admin/reports/sales', heading: 'تقرير المبيعات' },
      { url: '/#/admin/reports/products', heading: 'تقرير المنتجات' },
      { url: '/#/admin/reports/customers', heading: 'تقرير العملاء' },
      { url: '/#/admin/reports/reservations', heading: 'تقرير الحجوزات' },
      { url: '/#/admin/reports/food-trace', heading: 'تتبع دفعات الغذاء' },
      { url: '/#/admin/reports/inventory-stock', heading: 'تقرير المخزون' },
      { url: '/#/admin/reports/supplier-stock', heading: 'تقرير مخزون الموردين' },
      { url: '/#/admin/reports/party-aging', heading: 'تقرير أعمار الديون للأطراف' },
      { url: '/#/admin/shift-reports', heading: 'تقارير الورديات' },
      { url: '/#/admin/wastage-expiry-reports', heading: 'تقارير الهدر والانتهاء (قيود خفيفة)' },
      { url: '/#/admin/accounting', heading: 'التقارير المالية' },
      { url: '/#/admin/reports/financial-journals', heading: 'التقارير المالية حسب دفتر اليومية' },
    ];

    for (const p of pages) {
      await test.step(`${p.url}`, async () => {
        await page.goto(p.url, { waitUntil: 'domcontentloaded' });
        await expectHeading(page, p.heading);
      });
    }
  });
});

