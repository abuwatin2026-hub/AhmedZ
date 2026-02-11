import { test, expect } from '@playwright/test';
import { adminStorageStatePath } from './global-setup';
import { runSmokeSql } from './utils/runSmokeSql';

test.use({ storageState: adminStorageStatePath });

const selectPartyByName = async (partySelect: ReturnType<import('@playwright/test').Page['locator']>, name: string) => {
  const options = await partySelect.locator('option').allTextContents();
  const idx = options.findIndex((t) => String(t || '').includes(name));
  if (idx < 0) throw new Error(`Party not found in select options: ${name}`);
  await partySelect.selectOption({ index: idx });
};

test.describe.serial('اختبارات دخان: التسويات + الدفعات المسبقة (UI + RPC + DB)', () => {
  test.beforeAll(async () => {
    runSmokeSql({
      sqlRelPath: 'supabase/smoke/smoke_ui_settlements_advances_seed.sql',
      okToken: 'UI_SETTLEMENTS_ADVANCES_SEED_OK',
      reportNamePrefix: 'ui-settlements-advances-seed',
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/admin/profile');
    await expect(page.getByRole('heading', { name: 'الملف الشخصي للمدير' })).toBeVisible({ timeout: 60_000 });
  });

  test('إدارة الدفعات المسبقة: تطبيق دفعة مقدمة على فاتورة', async ({ page }) => {
    await page.goto('/#/admin/advances');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Advance Management' })).toBeVisible({ timeout: 60_000 });

    const partySelect = page.locator('select').first();
    await selectPartyByName(partySelect, 'UI Advance Party');

    await expect(page.getByText('فواتير مفتوحة')).toBeVisible();
    await expect(page.getByText('دفعات مقدمة مفتوحة')).toBeVisible();

    const invoicesTable = page.getByRole('table').nth(0);
    const advancesTable = page.getByRole('table').nth(1);

    await expect(invoicesTable).toBeVisible({ timeout: 60_000 });
    await expect(advancesTable).toBeVisible({ timeout: 60_000 });

    await expect(invoicesTable.getByText('لا توجد فواتير.')).toHaveCount(0);
    await expect(advancesTable.getByText('لا توجد دفعات.')).toHaveCount(0);

    await invoicesTable.getByRole('button', { name: 'اختيار' }).first().click();
    await advancesTable.getByRole('button', { name: 'اختيار' }).first().click();

    await page.getByRole('button', { name: 'تطبيق على فاتورة' }).click();
    await expect(page.getByText('تم تطبيق الدفعة المقدمة.')).toBeVisible({ timeout: 60_000 });
  });

  test('التسويات: تشغيل Auto Match وإظهار تسوية حديثة', async ({ page }) => {
    await page.goto('/#/admin/settlements');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Settlement Workspace' })).toBeVisible({ timeout: 60_000 });

    const partySelect = page.locator('select').first();
    await selectPartyByName(partySelect, 'UI Settlement Party');

    await expect(page.getByRole('button', { name: 'تشغيل Auto Match (FIFO)' })).toBeVisible();

    await expect(page.getByText('عناصر مدينة (Debits)')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('عناصر دائنة (Credits)')).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText('لا توجد عناصر.')).toHaveCount(0);

    await page.getByRole('button', { name: 'تشغيل Auto Match (FIFO)' }).click();
    await expect(page.getByText(/تمت التسوية التلقائية/)).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText('Settlements الأخيرة')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('لا توجد تسويات.')).toHaveCount(0);
  });
});

