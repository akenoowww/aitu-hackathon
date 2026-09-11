import { z } from 'zod'
import type { components } from './api.generated'

export type User = components['schemas']['UserOutput']
export type MeetingSummary = components['schemas']['MeetingSummary']
export type MeetingDetail = components['schemas']['MeetingDetail']
export type MeetingList = components['schemas']['MeetingList']
export type MeetingCreate = components['schemas']['MeetingCreate']
export type LoginInput = components['schemas']['LoginInput']

export const userSchema = z.object({
  id: z.uuid(), email: z.string(), display_name: z.string(),
}) satisfies z.ZodType<User>

export const languageSchema = z.enum(['auto', 'ru', 'kk', 'en'])
export const languageLabels: Record<z.infer<typeof languageSchema>, string> = {
  auto: 'Авто · Қазақша / Русский / English', ru: 'Русский', kk: 'Қазақша', en: 'English',
}
export const transcriptionSchema = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  progress: z.number().int().min(0).max(100), error_code: z.string().nullable(),
  detected_language: z.string().nullable(), duration_seconds: z.number().nullable(),
})
export const meetingSummarySchema = z.object({
  id: z.uuid(), title: z.string(), language: languageSchema,
  status: z.enum(['draft', 'transcribed']), source_type: z.enum(['text', 'audio']),
  created_at: z.string(), updated_at: z.string(),
  transcript_length: z.number().int().nonnegative(),
  // Text-only API versions omit audio metadata; keep those meetings readable.
  transcription: transcriptionSchema.nullable().default(null),
}) satisfies z.ZodType<MeetingSummary>
export const meetingDetailSchema = meetingSummarySchema.extend({
  transcript: z.string(),
  audio_filename: z.string().nullable().default(null), audio_bytes: z.number().nullable().default(null),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string(), speaker: z.string().nullable().optional() })).nullable().default(null),
}) satisfies z.ZodType<MeetingDetail>
export const meetingListSchema = z.object({
  items: z.array(meetingSummarySchema), total: z.number().int().nonnegative(),
  limit: z.number().int().positive(), offset: z.number().int().nonnegative(),
}) satisfies z.ZodType<MeetingList>

export const loginSchema = z.object({
  email: z.email('Введите корректную электронную почту'),
  password: z.string().min(1, 'Введите пароль').max(1024, 'Пароль слишком длинный'),
}) satisfies z.ZodType<LoginInput>
export const meetingCreateSchema = z.object({
  title: z.string().trim().min(1, 'Введите название встречи').max(200, 'Не более 200 символов'),
  language: languageSchema,
  // Transcript is source material: validation must never trim or rewrite it.
  transcript: z.string().max(200_000, 'Не более 200 000 символов')
    .refine((value) => value.trim().length > 0, 'Добавьте текст стенограммы'),
}) satisfies z.ZodType<MeetingCreate>
export const meetingSearchSchema = z.object({
  q: z.string().max(200).catch(''),
  offset: z.coerce.number().int().min(0).max(100_000).catch(0),
})

export const meetingViewSearchSchema = z.object({
  view: z.enum(['conversation', 'insights', 'kanban']).optional().catch(undefined),
})
