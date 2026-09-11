import { z } from 'zod'
import { ApiError } from './api'
import type { components } from './api.generated'

export const ragStatusSchema = z.object({
  index_id: z.uuid().nullable(),
  status: z.enum(['not_indexed', 'queued', 'running', 'ready', 'failed']),
  node_count: z.number().int(), error_code: z.string().nullable(),
}) satisfies z.ZodType<components['schemas']['IndexStatus']>
const sourceSchema = z.object({
  source_id: z.string(), node_id: z.uuid(), parent_id: z.uuid().nullable(),
  start_char: z.number().int(), end_char: z.number().int(), text: z.string(),
  reason: z.enum(['hit', 'parent', 'neighbor']),
})
const citationSchema = z.object({
  source_id: z.string(), node_id: z.uuid(), start_char: z.number().int(),
  end_char: z.number().int(), quote: z.string(),
})
const answerSchema = z.object({
  status: z.enum(['answered', 'insufficient_evidence']), answer: z.string(),
  claims: z.array(z.object({ text: z.string(), citations: z.array(citationSchema) })),
  sources: z.array(sourceSchema), index_id: z.uuid(), model: z.string(),
  provider: z.string(), prompt_version: z.string(),
}) satisfies z.ZodType<components['schemas']['Answer']>
const configSchema = z.object({
  offline: z.boolean(), llm_provider: z.string(), llm_model: z.string(), reasoning_effort: z.string(),
  embedding_provider: z.string(), embedding_model: z.string(), embedding_dimensions: z.number(),
  cloud_configured: z.boolean(),
}) satisfies z.ZodType<components['schemas']['RagConfiguration']>

export type RagAnswer = z.infer<typeof answerSchema>

async function request<T>(path: string, schema: z.ZodType<T>, question?: string | null, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: question === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aimeet' },
    body: typeof question === 'string' ? JSON.stringify({ question }) : undefined,
  })
  if (!response.ok) {
    let code = 'request'
    try {
      const body: unknown = await response.json()
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(body)
      if (parsed.success) code = parsed.data.error.code
    } catch { /* Keep a safe fallback. */ }
    throw new ApiError(response.status, code)
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new ApiError(502, 'invalid-response')
  return parsed.data
}
const path = (id: string) => `/meetings/${encodeURIComponent(id)}/rag`
export const ragApi = {
  config: (signal?: AbortSignal) => request('/rag/config', configSchema, undefined, signal),
  status: (id: string, signal?: AbortSignal) => request(`${path(id)}/index`, ragStatusSchema, undefined, signal),
  index: (id: string) => request(`${path(id)}/index`, ragStatusSchema, null),
  ask: (id: string, question: string) => request(`${path(id)}/chat`, answerSchema, question),
}

export function ragError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      OPENAI_KEY_REQUIRED: 'Для вопросов к встрече нужно настроить ключ OpenAI на сервере.',
      INDEX_NOT_READY: 'Сначала подготовьте встречу для вопросов.',
      TRANSCRIPT_NOT_READY: 'Вопросы станут доступны после расшифровки записи.',
      PROVIDER_TIMEOUT: 'Модель не успела ответить. Попробуйте ещё раз.',
      PROVIDER_UNAVAILABLE: 'Не удалось подключиться к модели. Проверьте, что она запущена.',
      PROVIDER_RATE_LIMIT: 'Достигнут лимит запросов к модели. Попробуйте позже.',
      UNGROUNDED_MODEL_RESPONSE: 'Не удалось подтвердить ответ цитатами. Попробуйте уточнить вопрос.',
      PROVIDER_REJECTED: 'Модель отклонила запрос. Проверьте её настройки и доступ на сервере.',
    }
    if (messages[error.kind]) return messages[error.kind]
    if (error.status === 401) return 'Войдите в рабочее пространство ещё раз.'
    if (error.status === 404) return 'Встреча больше недоступна.'
  }
  return 'Не удалось получить ответ. Попробуйте ещё раз.'
}
