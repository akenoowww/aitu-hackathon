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

const workspaceCoverageSchema = z.object({
  total: z.number().int().nonnegative(), ready: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  not_indexed: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative(),
}) satisfies z.ZodType<components['schemas']['WorkspaceCoverage']>
const workspaceAnswerSchema = z.object({
  status: z.enum(['answered', 'insufficient_evidence']), answer: z.string(),
  claims: z.array(z.object({ text: z.string(), citations: z.array(z.union([
    citationSchema, z.object({ kind: z.literal('catalog'), source_id: z.string(), quote: z.string() }),
  ])) })),
  sources: z.array(sourceSchema.extend({
    meeting_id: z.uuid(), meeting_title: z.string(), meeting_created_at: z.string(),
  })),
  coverage: workspaceCoverageSchema,
  catalog_sources: z.array(z.object({ source_id: z.string(), text: z.string(), meeting_id: z.uuid().nullable(), meeting_title: z.string().nullable() })).default([]),
}) satisfies z.ZodType<components['schemas']['WorkspaceAnswer']>
export type WorkspaceAnswer = z.infer<typeof workspaceAnswerSchema>
export type WorkspaceCoverage = z.infer<typeof workspaceCoverageSchema>

export type ConversationMessage = { role: 'user' | 'assistant'; content: string }
export type AssistantResult = { mode: 'assistant'; answer: string } | (WorkspaceAnswer & { mode: 'meetings' })
const assistantDecisionSchema = z.object({
  action: z.enum(['reply', 'search_meetings']), answer: z.string(), search_query: z.string(),
}) satisfies z.ZodType<components['schemas']['AssistantDecision']>

export async function talkToAssistant(question: string, history: ConversationMessage[], signal: AbortSignal): Promise<AssistantResult> {
  const decision = await request('/assistant/chat', assistantDecisionSchema, { question, history }, signal)
  if (decision.action === 'reply') return { mode: 'assistant', answer: decision.answer }
  const result = await searchWorkspace(decision.search_query, signal, () => {})
  return { ...result, mode: 'meetings' }
}

async function request<T>(path: string, schema: z.ZodType<T>, question?: string | { question: string; history: ConversationMessage[] } | null, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: question === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aimeet' },
    body: typeof question === 'string' ? JSON.stringify({ question }) : question ? JSON.stringify(question) : undefined,
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
  workspaceStatus: (signal?: AbortSignal) => request('/rag/index', workspaceCoverageSchema, undefined, signal),
  indexWorkspace: (signal?: AbortSignal) => request('/rag/index', workspaceCoverageSchema, null, signal),
  askWorkspace: (question: string, signal?: AbortSignal) => request('/rag/chat', workspaceAnswerSchema, question, signal),
  config: (signal?: AbortSignal) => request('/rag/config', configSchema, undefined, signal),
  status: (id: string, signal?: AbortSignal) => request(`${path(id)}/index`, ragStatusSchema, undefined, signal),
  index: (id: string) => request(`${path(id)}/index`, ragStatusSchema, null),
  ask: (id: string, question: string) => request(`${path(id)}/chat`, answerSchema, question),
}

export async function searchWorkspace(question: string, signal: AbortSignal, onCoverage: (coverage: WorkspaceCoverage) => void) {
  let coverage = await ragApi.workspaceStatus(signal)
  onCoverage(coverage)
  if (coverage.not_indexed || coverage.failed) {
    coverage = await ragApi.indexWorkspace(signal)
    onCoverage(coverage)
  }
  // Preparing existing transcripts is part of search, not a separate user task.
  const deadline = Date.now() + 180_000
  while (coverage.pending > 0) {
    if (Date.now() >= deadline) throw new ApiError(504, 'SEARCH_PREPARING')
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted()
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500)
      signal.addEventListener('abort', abort, { once: true })
    })
    coverage = await ragApi.workspaceStatus(signal)
    onCoverage(coverage)
  }
  if (!coverage.ready && coverage.failed) throw new ApiError(503, 'WORKSPACE_SEARCH_FAILED')
  return ragApi.askWorkspace(question, signal)
}

export function ragError(error: unknown, scope: 'meeting' | 'workspace' = 'meeting'): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      OPENAI_KEY_REQUIRED: 'Для вопросов к встрече нужно настроить ключ OpenAI на сервере.',
      INDEX_NOT_READY: 'Сначала подготовьте встречу для вопросов.',
      WORKSPACE_INDEX_NOT_READY: 'Стенограммы ещё обрабатываются. Попробуйте отправить вопрос чуть позже.',
      WORKSPACE_SEARCH_FAILED: 'Не удалось обработать стенограммы для поиска. Попробуйте отправить вопрос ещё раз.',
      SEARCH_PREPARING: 'Стенограммы ещё обрабатываются. Попробуйте отправить вопрос чуть позже.',
      SOURCE_CHANGED: 'Одна из встреч изменилась во время поиска. Задайте вопрос ещё раз.',
      TRANSCRIPT_NOT_READY: 'Вопросы станут доступны после расшифровки записи.',
      PROVIDER_TIMEOUT: 'Модель не успела ответить. Попробуйте ещё раз.',
      PROVIDER_UNAVAILABLE: 'Не удалось подключиться к модели. Проверьте, что она запущена.',
      PROVIDER_RATE_LIMIT: 'Достигнут лимит запросов к модели. Попробуйте позже.',
      UNGROUNDED_MODEL_RESPONSE: 'Не удалось подтвердить ответ цитатами. Попробуйте уточнить вопрос.',
      PROVIDER_REJECTED: 'Модель отклонила запрос. Проверьте её настройки и доступ на сервере.',
    }
    if (messages[error.kind]) return messages[error.kind]
    if (error.status === 401) return 'Войдите в рабочее пространство ещё раз.'
    if (error.status === 404) return scope === 'workspace'
      ? 'Общий поиск пока недоступен на сервере.'
      : 'Встреча больше недоступна.'
  }
  return 'Не удалось получить ответ. Попробуйте ещё раз.'
}
