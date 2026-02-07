import { test, expect } from '@playwright/test';
import { adminStorageStatePath } from './global-setup';

test.use({ storageState: adminStorageStatePath });

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test.describe.serial('اختبارات دخان: لوحة التحكم', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/admin/profile');
    await expect(page.getByRole('heading', { name: 'الملف الشخصي للمدير' })).toBeVisible({ timeout: 60_000 });
  });

  test('التقارير المالية والمستندات المطبوعة تفتح بدون أخطاء', async ({ page }) => {
    await page.goto('/#/admin/accounting');
    await expect(page).toHaveURL(/#\/admin\/(accounting|reports\/financial)/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'التقارير المالية' })).toBeVisible();
    await expect(page.getByTitle('التسويات البنكية')).toBeVisible();
    await expect(page.getByTitle('الأبعاد المالية')).toBeVisible();

    await page.goto('/#/admin/printed-documents');
    await expect(page.getByRole('main').getByRole('heading', { name: 'المستندات المطبوعة' })).toBeVisible();
  });

  test('دفاتر اليومية: إنشاء دفتر وتعيينه افتراضي', async ({ page }) => {
    const suffix = uid();
    const code = `UI${suffix.slice(-6)}`.toUpperCase();
    await page.goto('/#/admin/journals');
    await expect(page.getByRole('heading', { name: 'دفاتر اليومية (Journals)' })).toBeVisible();

    await page.getByPlaceholder('الكود (مثال: SALES)').fill(code);
    await page.getByPlaceholder('الاسم').fill(`دفتر UI ${suffix}`);
    await page.getByRole('button', { name: 'إنشاء' }).click();

    const row = page.locator('tr', { hasText: code }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: 'تعيين افتراضي' }).click();
    await expect(row.getByText('نعم', { exact: true })).toBeVisible({ timeout: 60_000 });
  });

  test('التقارير حسب دفتر اليومية: تفتح وتحوّل للتقارير المالية', async ({ page }) => {
    await page.goto('/#/admin/reports/financial-journals');
    await expect(page.getByRole('heading', { name: 'التقارير المالية حسب دفتر اليومية' })).toBeVisible();

    const openBtn = page.getByRole('link', { name: 'فتح التقارير' }).first();
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    await expect(page).toHaveURL(/#\/admin\/accounting\?.*jId=/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'التقارير المالية' })).toBeVisible({ timeout: 60_000 });
  });

  test('إعدادات الرواتب: إضافة قاعدة وضريبة', async ({ page }) => {
    const suffix = uid();
    await page.goto('/#/admin/payroll-config');
    await expect(page.getByRole('heading', { name: 'إعدادات الرواتب (قواعد/ضرائب)' })).toBeVisible();

    await page.getByPlaceholder('الاسم').fill(`بدل UI ${suffix}`);
    await page.getByPlaceholder('القيمة').fill('1000');
    await page.getByRole('button', { name: 'إضافة قاعدة' }).click();
    await expect(page.getByRole('cell', { name: `بدل UI ${suffix}` })).toBeVisible();

    await page.getByPlaceholder('اسم الضريبة').fill(`ضريبة UI ${suffix}`);
    await page.getByPlaceholder('النسبة %').fill('5');
    await page.getByRole('button', { name: 'إضافة ضريبة' }).click();
    await expect(page.getByRole('cell', { name: `ضريبة UI ${suffix}` })).toBeVisible();
  });

  test('الأبعاد المالية: إضافة قسم ومشروع', async ({ page }) => {
    const suffix = uid();
    await page.goto('/#/admin/financial-dimensions');
    await expect(page.getByRole('heading', { name: 'الأبعاد المالية (الأقسام/المشاريع)' })).toBeVisible();

    const deptsCard = page.getByText('الأقسام', { exact: true }).locator('..');
    const projectsCard = page.getByText('المشاريع', { exact: true }).locator('..');

    const deptCode = `D${suffix.slice(-4)}`;
    await deptsCard.getByPlaceholder('الكود').fill(deptCode);
    await deptsCard.getByPlaceholder('الاسم').fill(`قسم UI ${suffix}`);
    await page.getByRole('button', { name: 'إضافة قسم' }).click();
    await expect(page.getByRole('cell', { name: deptCode, exact: true })).toBeVisible();

    const projCode = `P${suffix.slice(-4)}`;
    await projectsCard.getByPlaceholder('الكود').fill(projCode);
    await projectsCard.getByPlaceholder('الاسم').fill(`مشروع UI ${suffix}`);
    await page.getByRole('button', { name: 'إضافة مشروع' }).click();
    await expect(page.getByRole('cell', { name: projCode, exact: true })).toBeVisible();
  });

  test('الرواتب: إنشاء موظف ومسير واحتساب', async ({ page }) => {
    const suffix = uid();
    const employeeName = `موظف UI ${suffix}`;
    const year = 2100 + (Date.now() % 50);
    const month = String((Date.now() % 12) + 1).padStart(2, '0');
    const period = `${year}-${month}`;
    await page.goto('/#/admin/payroll');
    await expect(page.getByRole('heading', { name: 'الرواتب (Payroll)' })).toBeVisible();

    await page.getByRole('button', { name: 'الموظفون' }).click();
    await page.getByRole('button', { name: 'إضافة موظف' }).click();

    const empModal = page.locator('.fixed.inset-0.z-50').filter({ hasText: 'الراتب الشهري' });
    await expect(empModal).toBeVisible();

    await empModal.locator('div:text-is("الاسم")').locator('..').locator('input').fill(employeeName);
    await empModal.locator('div:text-is("الكود (اختياري)")').locator('..').locator('input').fill(`UI-${suffix.slice(-6)}`);
    await empModal.locator('div:text-is("العملة")').locator('..').locator('input').fill('YER');
    await empModal.locator('div:text-is("الراتب الشهري")').locator('..').locator('input').fill('20000');
    await empModal.getByRole('button', { name: 'حفظ' }).click();
    await expect(empModal).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(employeeName)).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'المسيرات' }).click();
    await page.locator('input[type="month"]').fill(period);
    await page.getByRole('button', { name: 'إنشاء مسير' }).click();

    const runModal = page.locator('.fixed.inset-0.z-50').filter({ hasText: `مسير رواتب ${period}` });
    try {
      await runModal.waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      const runRow = page.locator('tr', { hasText: period }).first();
      await expect(runRow).toBeVisible({ timeout: 60_000 });
      await runRow.getByRole('button', { name: 'عرض' }).click();
      await runModal.waitFor({ state: 'visible', timeout: 60_000 });
    }

    await runModal.getByRole('button', { name: 'احتساب الرواتب' }).click();
    await expect(runModal.getByText(employeeName)).toBeVisible({ timeout: 60_000 });
  });

  test('التسويات البنكية: إنشاء حساب ودفعة واستيراد سطر', async ({ page }) => {
    const suffix = uid();
    await page.goto('/#/admin/bank-reconciliation');
    await expect(page.getByRole('main').getByRole('heading', { name: 'التسويات البنكية' })).toBeVisible();

    await page.getByPlaceholder('اسم الحساب').fill(`UI Bank ${suffix}`);
    await page.getByPlaceholder('اسم البنك').fill('UI Bank');
    await page.getByPlaceholder('رقم الحساب').fill(`ACC-${suffix.slice(-6)}`);
    await page.getByPlaceholder('العملة (YER)').fill('YER');
    await page.getByRole('button', { name: 'حفظ الحساب' }).click();

    await page.getByRole('button', { name: new RegExp(`UI Bank ${suffix}`) }).click();
    const createBatch = page.getByRole('button', { name: 'إنشاء دفعة' });
    await createBatch.scrollIntoViewIfNeeded();
    await createBatch.click({ force: true });

    const ext = `UI-EXT-${suffix.slice(-6)}`;
    await page.locator('textarea[placeholder^="JSON:"]').fill(JSON.stringify([
      { date: '2099-12-05', amount: 1500, currency: 'YER', description: 'UI Smoke', externalId: ext },
    ]));
    await page.getByRole('button', { name: 'استيراد' }).click();
    await expect(page.getByText(ext)).toBeVisible();
  });
});
