import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { ArrowLeft } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { meetingCreateSchema, languageLabels } from '../lib/contracts'
import { meetingQuery, queryClient } from '../lib/query'
import { FieldError, PageHeading } from '../components/ui'

type FormValues = z.infer<typeof meetingCreateSchema>
function CharacterCount({ control }: { control: Control<FormValues> }) {
  const value = useWatch({ control, name: 'transcript' })
  return <span className="character-count">{new Intl.NumberFormat('ru').format(value?.length ?? 0)} / 200 000</span>
}

export function NewMeetingPage() {
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    resolver: zodResolver(meetingCreateSchema), defaultValues: { title: '', language: 'auto', transcript: '' },
  })
  const create = useMutation({
    mutationFn: api.createMeeting,
    onSuccess: async (meeting) => {
      queryClient.setQueryData(meetingQuery(meeting.id).queryKey, meeting)
      await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
      await navigate({ to: '/meetings/$meetingId', params: { meetingId: meeting.id } })
    },
  })
  return <div className="page">
    <Link className="page-back" to="/meetings" search={{ q: '', offset: 0 }}><ArrowLeft size={19} aria-hidden="true" />К встречам</Link>
    <header className="page-header"><PageHeading title="Новая встреча" /></header>
    <section className="form-panel">
      <form className="meeting-form" noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <div className="field">
          <label className="field-label" htmlFor="title">Название встречи</label>
          <input className="input" id="title" maxLength={200} autoComplete="off" aria-invalid={!!form.formState.errors.title} aria-describedby="title-error" {...form.register('title')} />
          <FieldError id="title-error" message={form.formState.errors.title?.message} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="language">Язык стенограммы</label>
          <select className="select" id="language" {...form.register('language')}>
            {Object.entries(languageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <div className="transcript-heading"><label className="field-label" htmlFor="transcript">Стенограмма</label><CharacterCount control={form.control} /></div>
          <textarea className="textarea" id="transcript" rows={11} maxLength={200_000} aria-invalid={!!form.formState.errors.transcript} aria-describedby="transcript-error" {...form.register('transcript')} />
          <FieldError id="transcript-error" message={form.formState.errors.transcript?.message} />
        </div>
        {create.isError && <p className="inline-error" role="alert">{errorMessage(create.error, 'Не удалось сохранить встречу. Ваш текст остался в форме. Попробуйте ещё раз.')}</p>}
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={create.isPending} aria-busy={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Сохранить встречу'}</button>
          <Link className="button button-secondary" to="/meetings" search={{ q: '', offset: 0 }}>Отмена</Link>
        </div>
      </form>
    </section>
  </div>
}
