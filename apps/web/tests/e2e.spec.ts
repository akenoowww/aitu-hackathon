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

async function expectNonceScrollLock(page: Page) {
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect.poll(() => page.evaluate(() => {
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
    const styles = Array.from(document.querySelectorAll('style'))
      .filter((style) => style.textContent?.includes('data-scroll-locked'));
    return Boolean(nonce && nonce !== '__AIMEET_CSP_NONCE__' && styles.length > 0 &&
      styles.every((style) => style.nonce === nonce && style.sheet !== null));
  })).toBe(true);
}

test('authenticated meeting lifecycle persists text and works on mobile', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy|violates.*policy/i.test(message.text())) browserErrors.push(message.text());
  });
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
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByLabel('Электронная почта', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Электронная почта', { exact: true })).toBeFocused();
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

    await page.getByRole('button', { name: 'Сохранить встречу', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название встречи', exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('textbox', { name: 'Название встречи', exact: true })).toBeFocused();
    await expect(page.getByLabel('Стенограмма', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('textbox', { name: 'Название встречи', exact: true }).fill(title);
    // Exercise the portalled Mantine Select on the narrowest supported viewport.
    await page.setViewportSize({ width: 320, height: 740 });
    const language = page.getByRole('combobox', { name: 'Язык стенограммы', exact: true });
    await expect(language).toHaveValue('Не указан');
    await language.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('language-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(language).toBeFocused();
    // Pointer hover resets Mantine's keyboard selection; keep it outside the popup.
    await page.mouse.move(0, 0);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const russianOptionId = await page.getByRole('option', { name: 'Русский', exact: true }).getAttribute('id');
    await expect(language).toHaveAttribute('aria-activedescendant', russianOptionId!);
    await expect(page.getByRole('option', { name: 'Русский', exact: true })).toHaveAttribute('data-combobox-selected', 'true');
    await language.press('Enter');
    await expect(language).toHaveValue('Русский');
    await expect(language).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.getByLabel('Стенограмма', { exact: true }).fill(transcript);

    await page.getByRole('radiogroup', { name: 'Источник встречи', exact: true }).getByText('Аудиозапись', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Аудиозапись', exact: true })).toBeChecked();
    const audioLanguage = page.getByRole('combobox', { name: 'Язык записи', exact: true });
    await audioLanguage.click();
    await page.getByRole('option', { name: 'Қазақша', exact: true }).click();
    await expect(audioLanguage).toHaveValue('Қазақша');
    const chooser = page.waitForEvent('filechooser');
    const fileField = page.getByRole('button', { name: 'Аудиозапись встречи', exact: true });
    await fileField.click();
    await (await chooser).setFiles({ name: 'Проверка выбора.wav', mimeType: 'audio/wav', buffer: Buffer.from('UI file chooser check') });
    await expect(fileField).toHaveText('Проверка выбора.wav');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('audio-form-mobile.png'), fullPage: true, animations: 'disabled' });
    // Changing the source keeps both forms intact without uploading test audio.
    await page.getByRole('radiogroup', { name: 'Источник встречи', exact: true }).getByText('Текст стенограммы', { exact: true }).click();
    await expect(language).toHaveValue('Русский');
    await expect(page.getByLabel('Стенограмма', { exact: true })).toHaveValue(transcript);

    // A failed save must retain the text and the controlled select's value.
    await page.route('**/api/v1/meetings', (route) => route.fulfill({ status: 503 }), { times: 1 });
    await page.getByRole('button', { name: 'Сохранить встречу', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Не удалось сохранить встречу');
    await expect(page.getByLabel('Стенограмма', { exact: true })).toHaveValue(transcript);
    await expect(language).toHaveValue('Русский');
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: testInfo.outputPath('meeting-form-desktop.png'), fullPage: true, animations: 'disabled' });
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/meetings' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Сохранить встречу', exact: true }).click();
    const creationResponse = await creation;
    expect(creationResponse.status()).toBe(201);
    const created = (await creationResponse.json()) as { id: string; language: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.language).toBe('ru');
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

    await page.setViewportSize({ width: 320, height: 740 });
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);
    await expectNoHorizontalOverflow(page);

    const deleteTrigger = page.getByRole('button', { name: 'Удалить встречу', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Удалить встречу?', exact: true });
    await deleteTrigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320);
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('delete-dialog-mobile.png'), fullPage: true, animations: 'disabled' });
    // A dialog may render even when CSP rejects Mantine's scroll-lock stylesheet.
    // Verify the production edge nonce authorizes the actual injected style.
    await expectNonceScrollLock(page);
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Удалить', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteTrigger).toBeFocused();
    await expectTranscript(page, transcript);

    await deleteTrigger.click();
    await page.route(`**/api/v1/meetings/${created.id}`, (route) => route.fulfill({ status: 503 }), { times: 1 });
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Не удалось удалить встречу');
    await expect(dialog).toBeVisible();
    await expectTranscript(page, transcript);
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
    expect(browserErrors).toEqual([]);
  } finally {
    if (createdPath && !deleted && !page.isClosed()) {
      try {
        // Cleanup is scoped to the UUID created by this test; never delete other records.
        await page.goto(createdPath);
        await page.getByRole('button', { name: 'Удалить встречу', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Удалить встречу?', exact: true })
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

test('workspace chat searches existing meetings without manual preparation', async ({ page }) => {
  const userId = randomUUID();
  const meetingId = randomUUID();
  const nodeId = randomUUID();
  let indexRequests = 0;
  let searches = 0;
  let polls = 0;
  let ready = false;
  const coverage = () => ({ total: 1, ready: ready ? 1 : 0, pending: !ready && indexRequests ? 1 : 0,
    failed: 0, not_indexed: !ready && !indexRequests ? 1 : 0, unavailable: 0 });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { id: userId, email: 'qa@example.com', display_name: 'QA' } });
    if (path === '/api/v1/rag/config') return route.fulfill({ json: { offline: true, llm_provider: 'ollama', llm_model: 'test', reasoning_effort: 'low', embedding_provider: 'ollama', embedding_model: 'test', embedding_dimensions: 3, cloud_configured: false } });
    if (path === '/api/v1/rag/index') {
      if (method === 'POST') indexRequests++;
      else if (indexRequests && ++polls >= 2) ready = true;
      return route.fulfill({ status: method === 'POST' ? 202 : 200, json: coverage() });
    }
    if (path === '/api/v1/rag/chat') {
      expect(ready).toBe(true);
      if (route.request().postDataJSON().question === 'у нас вообще встречи были?') {
        return route.fulfill({ json: {
          status: 'answered', answer: 'Да, в архиве есть одна встреча.', coverage: coverage(), sources: [],
          catalog_sources: [{ source_id: 'M0', text: 'Сохранено встреч: 1.', meeting_id: null, meeting_title: null }],
          claims: [{ text: 'Да, в архиве есть одна встреча.', citations: [{ kind: 'catalog', source_id: 'M0', quote: 'Сохранено встреч: 1.' }] }],
        } });
      }
      expect(route.request().postDataJSON().question).toContain('бюджет');
      searches++;
      return route.fulfill({ json: {
        status: 'answered', answer: 'Обсуждали на планировании.', coverage: coverage(),
        claims: [{ text: 'Обсуждали на планировании.', citations: [{ source_id: 'S1', node_id: nodeId, start_char: 0, end_char: 19, quote: 'Бюджет согласовали.' }] }],
        sources: [{ source_id: 'S1', node_id: nodeId, parent_id: null, start_char: 0, end_char: 19, text: 'Бюджет согласовали.', reason: 'hit', meeting_id: meetingId, meeting_title: 'Планирование', meeting_created_at: '2026-09-11T09:00:00Z' }],
      } });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Чат', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Подготовить|Добавить встречу/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Добавить встречу' })).toHaveCount(0);
  await page.getByRole('button', { name: 'На какой встрече обсуждали бюджет?' }).click();
  const send = page.getByRole('button', { name: 'Отправить вопрос' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('Ищем по стенограммам встреч…')).toBeVisible();
  await expect(page.getByText('Обсуждали на планировании.')).toBeVisible();
  expect(indexRequests).toBe(1);
  expect(searches).toBe(1);
  await page.locator('.workspace-chat-source summary').click();
  await expect(page.locator('blockquote')).toHaveText('Бюджет согласовали.');
  await expect(page.getByRole('link', { name: 'Открыть встречу' })).toHaveAttribute('href', `/meetings/${meetingId}`);
  await page.getByRole('textbox', { name: 'Вопрос по всем встречам' }).fill('Какой бюджет?');
  await send.click();
  await expect(page.locator('.workspace-chat-turn')).toHaveCount(2);
  expect(searches).toBe(2);
  expect(indexRequests).toBe(1);
  await page.getByRole('textbox', { name: 'Вопрос по всем встречам' }).fill('у нас вообще встречи были?');
  await send.click();
  await expect(page.getByText('Да, в архиве есть одна встреча.')).toBeVisible();
  await page.getByText('Список встреч', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Все встречи', exact: true })).toHaveAttribute('href', /\/meetings/);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const header = await page.locator('.workspace-chat-header').boundingBox();
  const conversation = await page.locator('.workspace-chat-conversation').boundingBox();
  const composer = await page.locator('.workspace-chat-composer-wrap').boundingBox();
  expect(header!.x).toBeLessThan(320);
  expect(Math.abs(header!.x - conversation!.x)).toBeLessThan(2);
  expect(Math.abs(header!.x - composer!.x)).toBeLessThan(2);
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
});
