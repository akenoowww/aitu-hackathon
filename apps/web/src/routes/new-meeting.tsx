import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import { Anchor, Button, SegmentedControl, Select, Text, Textarea, TextInput } from '@mantine/core'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { ArrowLeft } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { meetingCreateSchema, languageLabels, type MeetingDetail } from '../lib/contracts'
import { meetingQuery, queryClient } from '../lib/query'
import { InlineError, PageHeading } from '../components/ui'
import { AudioUpload } from '../components/audio-upload'

type FormValues = z.infer<typeof meetingCreateSchema>
function CharacterCount({ control }: { control: Control<FormValues> }) {
  const value = useWatch({ control, name: 'transcript' })
  return <Text size="xs" c="dimmed" className="character-count">{new Intl.NumberFormat('ru').format(value?.length ?? 0)} / 200 000</Text>
}

export function NewMeetingPage() {
  const [source, setSource] = useState<'text' | 'audio'>('text')
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    resolver: zodResolver(meetingCreateSchema), defaultValues: { title: '', language: 'auto', transcript: '' },
  })
  const onSuccess = async (meeting: MeetingDetail) => {
    queryClient.setQueryData(meetingQuery(meeting.id).queryKey, meeting)
    await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
    await navigate({ to: '/meetings/$meetingId', params: { meetingId: meeting.id } })
  }
  const create = useMutation({ mutationFn: api.createMeeting, onSuccess })
  return <div className="page">
    <Anchor className="page-back" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}><ArrowLeft size={19} aria-hidden="true" />К встречам</Anchor>
    <header className="page-header"><PageHeading title="Новая встреча" /></header>
    <section className="form-panel">
      <SegmentedControl className="source-picker" aria-label="Источник встречи" value={source} onChange={(value) => { if (value === 'text' || value === 'audio') setSource(value) }}
        data={[{ value: 'text', label: 'Текст стенограммы' }, { value: 'audio', label: 'Аудиозапись' }]} />
      <div hidden={source !== 'audio'}><AudioUpload onSuccess={onSuccess} /></div>
      <div hidden={source !== 'text'}>
        <form className="meeting-form" aria-label="Текст стенограммы" noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <TextInput label="Название встречи" id="title" maxLength={200} autoComplete="off" error={form.formState.errors.title?.message} {...form.register('title')} />
          <Controller name="language" control={form.control} render={({ field, fieldState }) => (
            <Select label="Язык стенограммы" id="language" name={field.name} ref={field.ref} value={field.value} onChange={(value) => { if (value) field.onChange(value) }} onBlur={field.onBlur}
              error={fieldState.error?.message} data={Object.entries(languageLabels).map(([value, label]) => ({ value, label }))} />
          )} />
          <div className="transcript-field">
            <Textarea label="Стенограмма" id="transcript" rows={11} maxLength={200_000} resize="vertical" error={form.formState.errors.transcript?.message} {...form.register('transcript')} />
            <CharacterCount control={form.control} />
          </div>
          {create.isError && <InlineError>{errorMessage(create.error, 'Не удалось сохранить встречу. Ваш текст остался в форме. Попробуйте ещё раз.')}</InlineError>}
          <div className="form-actions">
            <Button type="submit" loading={create.isPending} aria-busy={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Сохранить встречу'}</Button>
            <Button variant="default" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}>Отмена</Button>
          </div>
        </form>
      </div>
    </section>
  </div>
}
