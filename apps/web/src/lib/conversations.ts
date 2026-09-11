import { z } from 'zod'
import { ApiError } from './api'
import { assistantResultSchema, type AssistantResult } from './rag'

const summarySchema = z.object({ id: z.uuid(), title: z.string(), created_at: z.string(), updated_at: z.string() })
const turnSchema = z.object({ id: z.uuid(), question: z.string(), result: assistantResultSchema, created_at: z.string() })
const detailSchema = summarySchema.extend({ turns: z.array(turnSchema) })
export type ConversationDetail = z.infer<typeof detailSchema>
export type ConversationSummary = z.infer<typeof summarySchema>

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/assistant/conversations${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aimeet' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new ApiError(response.status, 'conversation')
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new ApiError(502, 'invalid-response')
  return parsed.data
}
export const conversationsApi = {
  list: (signal?: AbortSignal) => request('', z.array(summarySchema), undefined, signal),
  create: (id: string) => request('', summarySchema, { id }),
  get: (id: string, signal?: AbortSignal) => request(`/${encodeURIComponent(id)}`, detailSchema, undefined, signal),
  saveTurn: (id: string, turn: { id: string; question: string; result: AssistantResult }, signal?: AbortSignal) => request(`/${encodeURIComponent(id)}/turns`, turnSchema, turn, signal),
}
