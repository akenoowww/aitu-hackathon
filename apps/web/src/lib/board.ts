import { z } from 'zod'
import { ApiError, errorMessage } from './api'
import type { components } from './api.generated'

export const kinds = { task: 'Поручения', decision: 'Решения', topic: 'Темы и тезисы', question: 'Открытые вопросы', risk: 'Риски и блокеры' }
export const statuses = { todo: 'К выполнению', doing: 'В работе', blocked: 'Заблокировано', done: 'Готово', dismissed: 'В архиве' }
export const agreements = { confirmed: 'Согласовано', proposed: 'Предложение', unclear: 'Нужно уточнить' }
export const clarificationLabels: Record<string, string> = {
  agreement_unconfirmed: 'Уточните, согласована ли договорённость',
  assignee_missing: 'Назначьте ответственного', deadline_missing: 'Уточните срок',
  date_unresolved: 'Укажите календарную дату для озвученного срока',
  priority_missing: 'Уточните приоритет, если он нужен',
}
export const priorities = { unspecified: 'Не указан', low: 'Низкий', medium: 'Средний', high: 'Высокий' }
export const cardInputSchema = z.object({
  kind: z.enum(['task', 'decision', 'topic', 'question', 'risk']),
  title: z.string().trim().min(1, 'Укажите суть карточки').max(500),
  description: z.string().max(4000), assignee: z.string().max(200).nullable(),
  due_date: z.iso.date().nullable(), due_text: z.string().max(200).nullable(),
  priority: z.enum(['unspecified', 'low', 'medium', 'high']),
  status: z.enum(['todo', 'doing', 'blocked', 'done', 'dismissed']), reviewed: z.boolean(),
  quote: z.string().min(1).max(2000).nullable(),
  quote_start: z.number().int().nonnegative().nullable(),
  agreement: z.enum(['confirmed', 'proposed', 'unclear']),
})
export const evidenceSchema = z.object({ quote: z.string(), start_char: z.number().int().nonnegative(), end_char: z.number().int().nonnegative(), start_seconds: z.number().nullable().default(null), end_seconds: z.number().nullable().default(null), speaker: z.string().nullable().default(null) })
export type Evidence = z.infer<typeof evidenceSchema>
export const cardSchema = cardInputSchema.extend({
  quote_start: z.number().nullable().default(null), agreement: z.enum(['confirmed', 'proposed', 'unclear']).default('unclear'),
  evidence: evidenceSchema.nullable().default(null),
  revisions: z.array(z.object({ field: z.enum(['due_text', 'assignee', 'decision']), before_value: z.string(), after_value: z.string(), before: evidenceSchema, after: evidenceSchema })).default([]),
  clarifications: z.array(z.string()).default([]),
  id: z.uuid(), origin: z.enum(['ai', 'manual']), start_char: z.number().nullable(), end_char: z.number().nullable(),
})
export const boardSchema = z.object({
  version: z.number().int(), status: z.enum(['idle', 'queued', 'running', 'ready', 'failed']),
  error_code: z.string().nullable(), progress: z.number(),
  summary: z.array(z.object({ text: z.string(), quote: z.string(), evidence: evidenceSchema.nullable().default(null) })), cards: z.array(cardSchema),
}) satisfies z.ZodType<components['schemas']['BoardOutput']>
export type Card = z.infer<typeof cardSchema>
export type CardInput = z.infer<typeof cardInputSchema>
export type Board = z.infer<typeof boardSchema>
export const emptyCard: CardInput = {
  kind: 'task', title: '', description: '', assignee: null, due_date: null, due_text: null,
  priority: 'unspecified', status: 'todo', reviewed: false, quote: null, quote_start: null, agreement: 'unclear',
}
const path = (id: string) => `/api/v1/meetings/${encodeURIComponent(id)}/board`
async function request(id: string, suffix = '', body?: unknown, signal?: AbortSignal): Promise<Board> {
  const response = await fetch(path(id) + suffix, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aimeet' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let code = 'request'
    try { const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(await response.json()); if (parsed.success) code = parsed.data.error.code } catch { /* Safe fallback. */ }
    throw new ApiError(response.status, code)
  }
  const parsed = boardSchema.safeParse(await response.json())
  if (!parsed.success) throw new ApiError(502, 'invalid-response')
  return parsed.data
}
export const boardApi = {
  get: (id: string, signal?: AbortSignal) => request(id, '', undefined, signal),
  generate: (id: string) => request(id, '/generate', {}),
  save: (id: string, version: number, values: CardInput, cardId?: string) => request(
    id, cardId ? `/cards/${encodeURIComponent(cardId)}` : '/cards', { ...values, version },
  ),
  async download(id: string, format: 'csv' | 'json' | 'ics') {
    const response = await fetch(`${path(id)}/export/${format}`, { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new ApiError(response.status)
    const url = URL.createObjectURL(await response.blob())
    const a = document.createElement('a'); a.href = url; a.download = `meeting-${id}.${format}`
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
export function boardError(error: unknown): string {
  const code = typeof error === 'string' ? error : error instanceof ApiError ? error.kind : ''
  const messages: Record<string, string> = {
    BOARD_CONFLICT: 'Карточки изменились в другом окне. Обновите доску и повторите изменение.',
    AMBIGUOUS_QUOTE: 'Этот фрагмент встречается в стенограмме несколько раз. Выберите более длинную уникальную цитату.',
    QUOTE_NOT_FOUND: 'Цитата не совпадает со стенограммой. Скопируйте исходный фрагмент без изменений.',
    INVALID_CORRECTION: 'Не удалось связать изменение с исходной договорённостью. Повторите разбор или заполните карточки вручную.',
    SOURCE_CHANGED: 'Стенограмма изменилась. Откройте встречу заново, чтобы проверить источники.',
    PROVIDER_UNAVAILABLE: 'Не удалось подключиться к локальной модели. Запустите её и повторите обработку.',
    PROVIDER_TIMEOUT: 'Локальная модель не успела завершить обработку. Повторите попытку.',
    PROVIDER_REJECTED: 'Локальная модель отклонила запрос. Проверьте, что модель установлена и запущена.',
    UNGROUNDED_MODEL_RESPONSE: 'В результате найдены цитаты, которых нет в стенограмме. Повторите обработку или добавьте карточки вручную.',
    TRANSCRIPT_NOT_READY: 'Для разбора встречи дождитесь готовой стенограммы.',
    BOARD_FULL: 'На доске достигнут лимит в 1500 карточек.',
    BOARD_EMPTY: 'Сначала добавьте карточку или разберите встречу.',
  }
  return messages[code] ?? errorMessage(error, 'Не удалось обработать доску. Попробуйте ещё раз.')
}
export function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function overdue(card: Card) {
  return card.kind === 'task' && !!card.due_date && card.due_date < today() && !['done', 'dismissed'].includes(card.status)
}
