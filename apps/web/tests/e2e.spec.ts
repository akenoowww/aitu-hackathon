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
    const chooser = page.waitForEvent('filechooser');
    await main.getByRole('button', { name: 'Загрузить аудио', exact: true }).first().click();
    await (await chooser).setFiles({ name: 'Проверка выбора.wav', mimeType: 'audio/wav', buffer: Buffer.from('UI file chooser check') });
    const uploadDialog = page.getByRole('dialog', { name: 'Загрузить аудио', exact: true });
    await expect(uploadDialog).toBeVisible();
    await expect(uploadDialog.getByLabel('Название встречи', { exact: true })).toHaveValue('Проверка выбора');
    await page.setViewportSize({ width: 320, height: 740 });
    const language = uploadDialog.getByRole('combobox', { name: 'Язык записи', exact: true });
    await language.click();
    await page.getByRole('option', { name: 'Русский', exact: true }).click();
    await expect(language).toHaveValue('Русский');
    await expectNoHorizontalOverflow(page);
    // A failed upload keeps the selected source and settings; no fixture audio is stored.
    await page.route('**/api/v1/meetings/audio?*', (route) => route.fulfill({ status: 503 }), { times: 1 });
    await uploadDialog.getByRole('button', { name: 'Распознать запись', exact: true }).click();
    await expect(uploadDialog.getByRole('alert')).toContainText('Не удалось загрузить аудио');
    await expect(uploadDialog.getByRole('button', { name: 'Аудиозапись встречи', exact: true })).toHaveText('Проверка выбора.wav');
    await page.screenshot({ path: testInfo.outputPath('audio-upload-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(uploadDialog).toBeHidden();
    // Existing text archives remain supported, though creation now offers audio only.
    const creationResponse = await page.request.post('/api/v1/meetings', {
      headers: { 'X-Requested-With': 'aimeet' }, data: { title, language: 'ru', transcript },
    });
    expect(creationResponse.status()).toBe(201);
    const created = (await creationResponse.json()) as { id: string; language: string };
    createdPath = `/meetings/${created.id}`;
    await page.goto(createdPath);

    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);
    await expectNoHorizontalOverflow(page);
    await page.reload();
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTranscript(page, transcript);

    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Встречи', exact: true })
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

test('workspace chat searches existing meetings without manual preparation', async ({ page }, testInfo) => {
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
    if (path === '/api/v1/assistant/chat') return route.fulfill({ json: {
      action: 'search_meetings', answer: '', search_query: route.request().postDataJSON().question,
    } });
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
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: testInfo.outputPath('chat-empty-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox())!.width)).toBe(64);
  await page.screenshot({ path: testInfo.outputPath('chat-empty-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'На какой встрече обсуждали бюджет?' }).click();
  const send = page.getByRole('button', { name: 'Отправить вопрос' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('Готовлю ответ…')).toBeVisible();
  await expect(page.getByText('Обсуждали на планировании.')).toBeVisible();
  expect(indexRequests).toBe(1);
  expect(searches).toBe(1);
  await page.locator('.workspace-chat-source summary').click();
  await expect(page.locator('blockquote')).toHaveText('Бюджет согласовали.');
  await expect(page.getByRole('link', { name: 'Открыть встречу' })).toHaveAttribute('href', `/meetings/${meetingId}`);
  await page.getByRole('textbox', { name: 'Сообщение ассистенту' }).fill('Какой бюджет?');
  await send.click();
  await expect(page.locator('.workspace-chat-turn')).toHaveCount(2);
  expect(searches).toBe(2);
  expect(indexRequests).toBe(1);
  await page.getByRole('textbox', { name: 'Сообщение ассистенту' }).fill('у нас вообще встречи были?');
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
  await page.screenshot({ path: testInfo.outputPath('chat-answer-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
});

test('audio upload shows progressive results and keeps the sidebar on the left', async ({ page }, testInfo) => {
  const id = '22222222-2222-4222-8222-222222222222';
  let stage = 0;
  const segments = [
    { start: 0, end: 4, text: 'Обсудим запуск пилота.' },
    { start: 5, end: 12, text: 'Алия подготовит смету к пятнице.' },
  ];
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.com', display_name: 'Проверка интерфейса' };
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = {
      id, title: 'Пилот', language: 'ru', source_type: 'audio', status: stage >= 2 ? 'transcribed' : 'draft',
      created_at: '2026-09-11T09:00:00Z', updated_at: '2026-09-11T09:00:00Z', audio_filename: 'Пилот.wav', audio_bytes: 100,
      transcript: segments.slice(0, stage + 1).map((segment) => segment.text).join('\n'), transcript_length: 55,
      segments: segments.slice(0, stage + 1),
      transcription: { status: stage >= 2 ? 'succeeded' : 'running', progress: stage >= 2 ? 100 : 30, error_code: null, detected_language: 'ru', duration_seconds: 20 },
    };
    let json: unknown;
    if (pathname === '/api/v1/auth/me') json = user;
    else if (pathname === '/api/v1/meetings') json = { items: [], total: 0, limit: 20, offset: 0 };
    else if (pathname === '/api/v1/meetings/audio' || pathname === `/api/v1/meetings/${id}`) json = body;
    else if (pathname.endsWith('/board')) json = {
      version: stage, status: stage < 2 ? 'idle' : stage === 2 ? 'running' : 'ready', progress: stage < 2 ? 0 : stage === 2 ? 45 : 100,
      error_code: null, cards: [], summary: stage < 2 ? [] : [{ text: 'Алия подготовит смету.', quote: segments[1].text }],
    };
    else if (pathname === '/api/v1/rag/config') json = { offline: true, llm_provider: 'ollama', llm_model: 'test', reasoning_effort: '', embedding_provider: 'ollama', embedding_model: 'test', embedding_dimensions: 768, cloud_configured: false };
    else if (pathname.endsWith('/rag/index')) json = { index_id: null, status: 'not_indexed', node_count: 0, error_code: null };
    else { await route.abort(); return; }
    await route.fulfill({ json });
  });
  await page.goto('/meetings');
  await expect(page.getByRole('heading', { name: 'Встречи', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Добавить встречу', exact: true })).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Загрузить аудио', exact: true }).first().click();
  await (await chooser).setFiles({ name: 'Пилот.wav', mimeType: 'audio/wav', buffer: Buffer.from('browser fixture; no actual inference') });
  await expect(page.getByLabel('Название встречи', { exact: true })).toHaveValue('Пилот');
  await page.getByRole('button', { name: 'Распознать запись', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${id}$`));
  await expect(page.getByText(segments[0].text, { exact: true })).toBeVisible();
  await expect(page.getByText(segments[1].text, { exact: true })).toHaveCount(0);
  stage = 1;
  await expect(page.getByText(segments[1].text, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть боковую панель', exact: true }).click();
  await expect(page.locator('.workspace-frame')).toHaveClass(/sidebar-collapsed/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Развернуть боковую панель', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(() => page.locator('.sidebar').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(64);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Развернуть боковую панель', exact: true }).click();
  await expect(page.locator('.workspace-frame')).toHaveClass(/sidebar-mobile-expanded/);
  await page.getByRole('button', { name: 'Свернуть боковую панель', exact: true }).click();
  stage = 2;
  await expect(page.getByRole('status')).toContainText('Готовим итоги');
  await page.getByRole('tab', { name: 'Итоги', exact: true }).click();
  await expect(page.getByText('Алия подготовит смету.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Промежуточные выводы могут уточняться/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('audio-stream-mobile.png'), fullPage: true, animations: 'disabled' });
  stage = 3;
  await expect(page.locator('.meeting-processing')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Канбан', exact: true })).toBeVisible();
  await expect(page.getByText(/Промежуточные выводы могут уточняться/)).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath('audio-stream-desktop.png'), fullPage: true, animations: 'disabled' });
});

test('live connection keeps the sidebar and places microphone with meeting actions', async ({ page }, testInfo) => {
  const roomId = '33333333-3333-4333-8333-333333333333';
  const grant = { room_id: roomId, participant_id: '44444444-4444-4444-8444-444444444444', name: 'Организатор', is_host: true, member_token: 'fixture', media_token: 'fixture', media_url: '/media' };
  await page.addInitScript((value) => {
    sessionStorage.setItem(`soyle-live:${value.room_id}`, JSON.stringify(value));
    sessionStorage.setItem(`soyle-live-autojoin:${value.room_id}`, '1');
  }, grant);
  let releaseConnection!: () => void;
  const connectionGate = new Promise<void>((resolve) => { releaseConnection = resolve; });
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/token')) {
      await connectionGate;
      await route.fulfill({ status: 503, json: {} });
    } else if (pathname === '/api/v1/auth/me') await route.fulfill({ json: { id: grant.participant_id, display_name: 'Организатор', email: 'preview@example.com' } });
    else if (pathname === `/api/v1/live/rooms/${roomId}`) await route.fulfill({ json: {
      id: roomId, title: 'Новая встреча', language: 'ru', status: 'active', created_at: '2026-09-11T09:00:00Z', ended_at: null, meeting_id: null,
      participants: [], utterances: [], insights: [], transcript_revision: 0, analysis_status: 'idle', analysis_error: null, audio_error: null, analysis_provider: 'test', can_end: true,
    } });
    else await route.abort();
  });
  await page.goto(`/live/${roomId}`);
  await expect(page.getByRole('heading', { name: 'Подключаемся к разговору', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть боковую панель', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('live-connecting.png'), fullPage: true, animations: 'disabled' });
  releaseConnection();
  await expect(page.getByText('Не удалось подключить голосовую связь.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подключаемся к разговору', exact: true })).toHaveCount(0);
  await expect(page.locator('.live-room-actions').getByRole('button', { name: 'Включить микрофон', exact: true })).toBeVisible();
  await expect(page.locator('.live-room-actions').getByRole('button', { name: 'Пригласить', exact: true })).toBeVisible();
  await expect(page.locator('.live-topbar')).toHaveCount(0);
  await expect(page.locator('.live-reveal')).toHaveCSS('opacity', '1');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('live-compact-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await expect.poll(() => page.locator('.sidebar').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(64);
  await page.screenshot({ path: testInfo.outputPath('live-compact-mobile.png'), fullPage: true, animations: 'disabled' });
});

test('new conversation starts with an automatic title and Russian language', async ({ page }, testInfo) => {
  let payload: { title: string; language: string } | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') await route.fulfill({ json: { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.com', display_name: 'Проверка интерфейса' } });
    else if (pathname === '/api/v1/live/rooms' && route.request().method() === 'POST') {
      payload = route.request().postDataJSON();
      await route.fulfill({ status: 503, json: {} });
    } else if (pathname === '/api/v1/live/rooms') await route.fulfill({ json: [] });
    else await route.abort();
  });
  await page.goto('/live');
  await expect(page.getByRole('button', { name: 'Новый разговор', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('live-entry-compact.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Новый разговор', exact: true }).click();
  await expect.poll(() => payload?.language).toBe('ru');
  expect(payload?.title).toMatch(/^Разговор · /);
  await expect(page.getByRole('alert')).toContainText('Голосовая связь пока недоступна');
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
});

test('assistant chats with history and helps without touching meeting search', async ({ page }) => {
  let messages = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { id: randomUUID(), email: 'qa@example.com', display_name: 'QA' } });
    if (path === '/api/v1/rag/config') return route.fulfill({ json: { offline: false, llm_provider: 'openai', llm_model: 'gpt-5.6-luna', reasoning_effort: 'max', embedding_provider: 'openai', embedding_model: 'test', embedding_dimensions: 3, cloud_configured: true } });
    if (path === '/api/v1/assistant/chat') {
      messages++;
      const body = route.request().postDataJSON();
      let answer = 'Привет, Алия! Чем помочь?';
      if (messages === 1) expect(body.history).toEqual([]);
      if (messages === 2) {
        expect(body.history).toEqual([
          { role: 'user', content: 'Привет, меня зовут Алия' },
          { role: 'assistant', content: 'Привет, Алия! Чем помочь?' },
        ]);
        answer = 'Вас зовут Алия.';
      }
      if (messages === 3) answer = 'Откройте «Встречи» и нажмите «Загрузить аудио».';
      if (messages === 4) expect(body.history).toEqual([]);
      return route.fulfill({ json: { action: 'reply', answer, search_query: '' } });
    }
    throw new Error(`Conversation must not access meetings or embeddings: ${path}`);
  });
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Чем могу помочь?' })).toBeVisible();
  await expect(page.getByText(/Вопросы и фрагменты встреч передаются/)).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Сообщение ассистенту' });
  const send = page.getByRole('button', { name: 'Отправить вопрос' });
  await input.fill('Привет, меня зовут Алия');
  await send.click();
  await expect(page.getByText('Привет, Алия! Чем помочь?', { exact: true })).toBeVisible();
  await input.fill('Как меня зовут?');
  await send.click();
  await expect(page.getByText('Вас зовут Алия.', { exact: true })).toBeVisible();
  await input.fill('Как загрузить запись?');
  await send.click();
  await expect(page.getByText('Откройте «Встречи» и нажмите «Загрузить аудио».', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новый диалог' }).click();
  await input.fill('Привет');
  await send.click();
  await expect(page.getByText('Привет, Алия! Чем помочь?', { exact: true })).toBeVisible();
  expect(messages).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('live transcript recovers after a temporary failure without hiding recent speech', async ({ page }) => {
  const roomId = '55555555-5555-4555-8555-555555555555';
  const participantId = '66666666-6666-4666-8666-666666666666';
  const grant = { room_id: roomId, participant_id: participantId, name: 'Участник', is_host: false, member_token: 'fixture', media_token: '', media_url: '/livekit' };
  const recent = { id: '77777777-7777-4777-8777-777777777777', participant_id: participantId, speaker: 'Участник', start: 30, end: 35, text: 'Последняя реплика остаётся видна.' };
  const earlier = { ...recent, id: '88888888-8888-4888-8888-888888888888', start: 0, end: 5, text: 'Ранняя реплика загружена после восстановления.' };
  let calls = 0;
  let recovered = false;
  await page.addInitScript((value) => {
    sessionStorage.setItem(`soyle-live:${value.room_id}`, JSON.stringify(value));
    sessionStorage.setItem(`soyle-live-autojoin:${value.room_id}`, '1');
  }, grant);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/transcript')) {
      calls += 1;
      await route.fulfill(!recovered ? { status: 503, json: {} } : { json: [earlier, recent] });
    } else if (url.pathname.endsWith(`/rooms/${roomId}`)) await route.fulfill({ json: {
      id: roomId, title: 'История разговора', language: 'ru', status: 'ended', created_at: '2026-09-11T09:00:00Z', ended_at: '2026-09-11T09:10:00Z', meeting_id: null,
      participants: [{ id: participantId, name: 'Участник', is_host: false }], utterances: [recent], insights: [], transcript_revision: 2,
      analysis_status: 'idle', analysis_error: null, audio_error: null, analysis_provider: 'test', can_end: false,
    } });
    else await route.abort();
  });
  await page.goto(`/live/${roomId}?view=conversation`);
  await expect(page.getByText(recent.text, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Повторим загрузку автоматически');
  await expect(page.getByText(recent.text, { exact: true })).toBeVisible();
  recovered = true;
  await expect(page.getByText(earlier.text, { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(recent.text, { exact: true })).toHaveCount(1);
  expect(calls).toBeGreaterThanOrEqual(3);
});

for (const sourceType of ['text', 'audio'] as const) {
  test(`saved ${sourceType} meeting uses live-style Conversation Outcomes Kanban tabs`, async ({ page }, testInfo) => {
    const id = '55555555-5555-4555-8555-555555555555';
    const transcript = 'Алия: подготовлю смету к пятнице.\nДанияр: согласовали запуск пилота.';
    let boardStatus: 'idle' | 'ready' = 'ready';
    let failBoard = false;
    const card = {
      id: '66666666-6666-4666-8666-666666666666', kind: 'task', title: 'Подготовить смету',
      description: '', assignee: 'Алия', due_date: null, due_text: 'к пятнице', priority: 'unspecified',
      status: 'todo', reviewed: false, quote: 'Алия: подготовлю смету к пятнице.', quote_start: 0,
      agreement: 'confirmed', origin: 'ai', start_char: 0, end_char: 32,
      evidence: null, revisions: [], clarifications: [],
    };
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/me')) return route.fulfill({ json: {
        id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.com', display_name: 'Тестовый профиль',
      } });
      if (path === `/api/v1/meetings/${id}`) return route.fulfill({ json: {
        id, title: 'Тест вкладок — данные проверки', language: 'ru', source_type: sourceType,
        status: sourceType === 'audio' ? 'transcribed' : 'draft',
        created_at: '2026-09-11T09:00:00Z', updated_at: '2026-09-11T09:00:00Z',
        audio_filename: sourceType === 'audio' ? 'Пример.wav' : null, audio_bytes: null,
        transcript, transcript_length: transcript.length, segments: null,
        transcription: sourceType === 'audio' ? { status: 'succeeded', progress: 100, error_code: null, detected_language: 'ru', duration_seconds: 20 } : null,
      } });
      if (path.endsWith('/board')) return route.fulfill(failBoard ? { status: 503, json: {} } : { json: {
        version: 1, status: boardStatus, error_code: null, progress: boardStatus === 'ready' ? 100 : 0,
        cards: boardStatus === 'ready' ? [card] : [],
        summary: boardStatus === 'ready' ? [{ text: 'Участники согласовали запуск пилота.', quote: 'Данияр: согласовали запуск пилота.', evidence: null }] : [],
      } });
      if (path.endsWith('/rag/config')) return route.fulfill({ json: { offline: true, llm_provider: 'ollama', llm_model: 'test', reasoning_effort: '', embedding_provider: 'ollama', embedding_model: 'test', embedding_dimensions: 768, cloud_configured: false } });
      if (path.endsWith('/rag/index')) return route.fulfill({ json: { index_id: null, status: 'not_indexed', node_count: 0, error_code: null } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(`/meetings/${id}`);
    const tabs = page.getByRole('tablist', { name: 'Разделы встречи', exact: true });
    await expect(tabs.getByRole('tab')).toHaveText(['Разговор', 'Итоги', 'Канбан']);
    await expect(page.getByRole('tabpanel', { name: 'Разговор', exact: true })).toBeVisible();
    await expectTranscript(page, transcript);
    await expect(page.locator('.kanban-grid')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('meeting-conversation.png'), fullPage: true });

    await page.getByRole('tab', { name: 'Итоги', exact: true }).click();
    await expect(page).toHaveURL(/view=insights/);
    await expect(page.getByText('Участники согласовали запуск пилота.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('transcript')).toHaveCount(0);
    await expect(page.locator('.kanban-grid')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('meeting-insights.png'), fullPage: true });
    await page.locator('.meeting-summary').getByRole('button', { name: 'К разговору' }).click();
    await expect(page.getByTestId('transcript')).toBeFocused();

    await page.getByRole('tab', { name: 'Канбан', exact: true }).click();
    await expect(page).toHaveURL(/view=kanban/);
    await expect(page.getByRole('region', { name: 'К выполнению', exact: true }).getByRole('button', { name: 'Подготовить смету', exact: true })).toBeVisible();
    await expect(page.getByTestId('transcript')).toHaveCount(0);
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Канбан', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Добавить карточку', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить карточку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Новая карточка' })).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('meeting-kanban-desktop.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.saved-meeting-header')).toBeHidden();
    await expect(page.locator('.board-print').getByRole('heading', { name: 'Тест вкладок — данные проверки', exact: true })).toBeVisible();
    await page.pdf({ path: testInfo.outputPath('meeting-protocol.pdf'), format: 'A4' });
    await page.emulateMedia({ media: 'screen' });

    await page.setViewportSize({ width: 320, height: 740 });
    await expect(tabs.getByRole('tab', { name: 'Канбан', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('meeting-kanban-mobile.png'), fullPage: true });
    boardStatus = 'idle';
    await page.reload();
    await expect(page.getByRole('button', { name: 'Добавить карточку', exact: true })).toBeEnabled();
    await expect(page.getByRole('tab', { name: 'Канбан', exact: true })).toBeVisible();
    failBoard = true;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
    await expect(page.locator('.kanban-card')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Разговор', exact: true }).click();
    await expectTranscript(page, transcript);
    expect(errors).toEqual([]);
  });
}
