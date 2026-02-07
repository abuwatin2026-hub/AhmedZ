import { chromium, type FullConfig } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const adminStorageStatePath = 'playwright/.auth/admin.json';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
  if (!baseURL) throw new Error('Missing baseURL');

  const email = process.env.ADMIN_EMAIL || 'owner@azta.com';
  const password = process.env.ADMIN_PASSWORD || 'Owner@123';

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/#/admin/login`, { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('#email');
  const usernameInput = page.locator('#username');
  await page.waitForSelector('#email, #username', { state: 'visible', timeout: 60_000 });
  if (await emailInput.isVisible()) {
    await emailInput.fill(email);
  } else {
    await usernameInput.fill(email);
  }
  await page.locator('#password').fill(password);

  const confirm = page.locator('#confirmPassword');
  if (await confirm.count()) {
    await confirm.fill(password);
  }

  await page.getByRole('button', { name: /تسجيل الدخول|إنشاء حساب المدير/ }).click();
  await page.waitForURL(/#\/admin\/(?!login)/, { timeout: 60_000 });
  await page.waitForSelector('a:has-text("الملف الشخصي")', { timeout: 60_000 });

  await mkdir(dirname(adminStorageStatePath), { recursive: true });
  await page.context().storageState({ path: adminStorageStatePath });
  await browser.close();
}

export { adminStorageStatePath };
