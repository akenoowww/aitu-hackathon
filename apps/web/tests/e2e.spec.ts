import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
            window.innerWidth,
        ),
      { message: 'The page must fit the viewport without horizontal scrolling.' },
    )
    .toBeLessThanOrEqual(1);
}

async function expectTranscript(page: Page, transcript: string) {
  const content = page.getByTestId('transcript');
  await expect(content).toBeVisible();
  // toHaveText normalizes whitespace; the stored transcript must remain verbatim.
  await expect.poll(() => content.textContent()).toBe(transcript);
}

test('authenticated meeting lifecycle persists text and works on mobile', async ({ page }, testInfo) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD for a provisioned test account.');
  }

  const title = `E2E сохранение ${randomUUID()}`;
  const transcript =
    '\n  Алия: Проверяем сохранение текста встречи без изменения пробелов.\n\n' +
    'Данияр: Подтверждаю, стенограмма должна сохраниться после перезагрузки.  \n';
  let createdPath: string | undefined;
  let deleted = false;

  // One login for the complete smoke keeps the real login rate limit intact.
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'Войти в рабочее пространство', exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings(?:\?.*)?$/);

  try {
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Встречи', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await main.getByRole('link', { name: 'Добавить встречу', exact: true }).first().click();
    await expect(main.getByRole('heading', { name: 'Новая встреча', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('Название встречи', { exact: true }).fill(title);
    await page.getByLabel('Язык стенограммы', { exact: true }).selectOption('ru');
    await page.getByLabel('Стенограмма', { exact: true }).fill(transcript);
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/meetings' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Сохранить встречу', exact: true }).click();
    const creationResponse = await creation;
    expect(creationResponse.status()).toBe(201);
    const created = (await creationResponse.json()) as { id: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    createdPath = `/meetings/${created.id}`;
    await page.waitForURL((url) => url.pathname === createdPath);

    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);
    await expectNoHorizontalOverflow(page);
    await page.reload();
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);

    await page
      .getByRole('navigation')
      .getByRole('link')
      .filter({ hasText: 'Встречи' })
      .first()
      .click();
    await expect(main.getByRole('heading', { name: 'Встречи', exact: true })).toBeVisible();
    await page.getByLabel('Поиск по названию', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(title);
    const result = main.getByRole('link', { name: title, exact: true });
    await expect(result).toHaveCount(1);
    await result.click();
    await expectTranscript(page, transcript);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);
    await expectNoHorizontalOverflow(page);

    const deleteTrigger = page.getByRole('button', { name: 'Удалить встречу', exact: true });
    const dialog = page.getByRole('alertdialog', { name: 'Удалить встречу?', exact: true });
    await deleteTrigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeVisible();
    // A dialog may render even when CSP rejects Radix's scroll-lock stylesheet.
    // Verify the production edge nonce authorizes the actual injected style.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect.poll(() => page.evaluate(() => {
      const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
      const styles = Array.from(document.querySelectorAll('style'))
        .filter((style) => style.textContent?.includes('data-scroll-locked'));
      return Boolean(nonce && nonce !== '__AIMEET_CSP_NONCE__' && styles.length > 0 &&
        styles.every((style) => style.nonce === nonce && style.sheet !== null));
    })).toBe(true);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteTrigger).toBeFocused();
    await expectTranscript(page, transcript);

    await deleteTrigger.click();
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page).toHaveURL(/\/meetings(?:\?.*)?$/);

    // A fresh search reads persisted state rather than relying on the cached list.
    const deletionLookup = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/v1/meetings' &&
        url.searchParams.get('q') === title &&
        response.request().method() === 'GET'
      );
    });
    await page.goto(`/meetings?q=${encodeURIComponent(title)}`);
    const deletionLookupResponse = await deletionLookup;
    expect(deletionLookupResponse.status()).toBe(200);
    expect(await deletionLookupResponse.json()).toMatchObject({ items: [], total: 0 });
    deleted = true;
    await expect(main.getByRole('heading', { name: 'Встречи', exact: true })).toBeVisible();
    await expect(page.getByLabel('Поиск по названию', { exact: true })).toHaveValue(title);
    await expect(result).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await page.goto('/meetings');
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByLabel('Электронная почта', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    if (createdPath && !deleted && !page.isClosed()) {
      try {
        // Cleanup is scoped to the UUID created by this test; never delete other records.
        await page.goto(createdPath);
        await page.getByRole('button', { name: 'Удалить встречу', exact: true }).click();
        await page
          .getByRole('alertdialog', { name: 'Удалить встречу?', exact: true })
          .getByRole('button', { name: 'Удалить', exact: true })
          .click();
        await expect(page).toHaveURL(/\/meetings(?:\?.*)?$/);
      } catch {
        testInfo.annotations.push({
          type: 'cleanup',
          description: `Could not remove test meeting ${title}.`,
        });
      }
    }
  }
});
