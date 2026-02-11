import { test, expect } from '@playwright/test';
import { adminStorageStatePath } from './global-setup';
import { runSmokeSql } from './utils/runSmokeSql';

test.use({ storageState: adminStorageStatePath });

test.describe.serial('اختبارات دخان: دورة مشتريات/شحنة/كشف حساب (Multi‑UOM + FX)', () => {
  test.beforeAll(async () => {
    runSmokeSql({
      sqlRelPath: 'supabase/smoke/smoke_local_uom_purchases_import_sales_party_ledger.sql',
      okToken: 'LOCAL_SCENARIO_SMOKE_OK',
      reportNamePrefix: 'ui-procurement-seed',
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/admin/profile');
    await expect(page.getByRole('heading', { name: 'الملف الشخصي للمدير' })).toBeVisible({ timeout: 60_000 });
  });

  test('المشتريات والشحنات وكشف الحساب تظهر بيانات سيناريو الدخان', async ({ page }) => {
    await page.goto('/#/admin/purchases');
    await expect(page.getByRole('heading', { name: 'أوامر الشراء (المخزون)' })).toBeVisible({ timeout: 60_000 });

    const supplierRows = page.locator('tr', { hasText: 'مورد دخان محلي' });
    await expect(supplierRows.first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => supplierRows.count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);

    await expect(page.locator('tr', { hasText: 'مورد دخان محلي' }).filter({ hasText: 'SAR' }).first()).toBeVisible();
    await expect(page.locator('tr', { hasText: 'مورد دخان محلي' }).filter({ hasText: 'YER' }).first()).toBeVisible();

    await page.goto('/#/admin/import-shipments');
    await expect(page.getByRole('heading', { name: 'إدارة الشحنات المستوردة' })).toBeVisible({ timeout: 60_000 });

    const shipmentCard = page.locator('div', { hasText: 'SMK-SHIP-' }).filter({ hasText: 'مغلقة' }).first();
    await expect(shipmentCard).toBeVisible({ timeout: 60_000 });
    await shipmentCard.click();

    await expect(page).toHaveURL(/#\/admin\/import-shipments\/[^/]+$/, { timeout: 60_000 });
    await expect(page.getByText('احتساب التكلفة')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('إغلاق الشحنة')).toHaveCount(0);

    await page.goto('/#/admin/financial-parties');
    await expect(page.getByRole('main').getByRole('heading', { name: 'الأطراف المالية' })).toBeVisible({ timeout: 60_000 });

    await page.getByPlaceholder('بحث بالاسم/النوع/المعرف...').fill('مورد دخان محلي');
    const supplierPartyRow = page.locator('tr', { hasText: 'مورد دخان محلي' }).first();
    await expect(supplierPartyRow).toBeVisible({ timeout: 60_000 });
    await supplierPartyRow.locator('a[title="كشف الحساب"]').click();

    await expect(page).toHaveURL(/#\/admin\/financial-parties\/[^/]+$/, { timeout: 60_000 });
    await page.getByPlaceholder('مثل YER/USD').fill('YER');
    await page.getByRole('button', { name: 'عرض' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('tbody tr td').filter({ hasText: 'YER' }).first()).toBeVisible({ timeout: 60_000 });
  });

  test('كشف حساب العميل يدعم العملات المتعددة', async ({ page }) => {
    await page.goto('/#/admin/financial-parties');
    await expect(page.getByRole('main').getByRole('heading', { name: 'الأطراف المالية' })).toBeVisible({ timeout: 60_000 });

    await page.getByPlaceholder('بحث بالاسم/النوع/المعرف...').fill('عميل دخان محلي');
    const customerPartyRow = page.locator('tr', { hasText: 'عميل دخان محلي' }).first();
    await expect(customerPartyRow).toBeVisible({ timeout: 60_000 });
    await customerPartyRow.locator('a[title="كشف الحساب"]').click();

    await expect(page).toHaveURL(/#\/admin\/financial-parties\/[^/]+$/, { timeout: 60_000 });
    await page.getByRole('button', { name: 'عرض' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('tbody tr td').filter({ hasText: 'USD' }).first()).toBeVisible({ timeout: 60_000 });
  });
});
