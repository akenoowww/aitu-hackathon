import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, FileInput, Select, TextInput } from '@mantine/core'
import { Upload } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import type { MeetingDetail } from '../lib/contracts'
import { InlineError } from './ui'
import './transcription.css'

export function AudioUpload({ onSuccess, initialFile = null }: { initialFile?: File | null; onSuccess: (meeting: MeetingDetail) => Promise<void> }) {
  const [title, setTitle] = useState(initialFile?.name.replace(/\.[^.]+$/, '').slice(0, 200) ?? '')
  const [language, setLanguage] = useState('auto')
  const [speakers, setSpeakers] = useState('auto')
  const [file, setFile] = useState<File | null>(initialFile)
  const [validation, setValidation] = useState('')
  const upload = useMutation({ mutationFn: api.uploadAudio, onSuccess })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) { setValidation('Введите название встречи.'); return }
    if (!file) { setValidation('Выберите аудиофайл.'); return }
    if (!/\.(mp3|wav|m4a)$/i.test(file.name)) { setValidation('Поддерживаются MP3, WAV и M4A.'); return }
    if (!file.size || file.size > 100 * 1024 * 1024) { setValidation('Выберите непустой файл размером до 100 МБ.'); return }
    setValidation('')
    upload.mutate({ title: title.trim(), language, file, numSpeakers: speakers === 'auto' ? undefined : Number(speakers) })
  }
  return <form className="meeting-form" aria-label="Аудиозапись" noValidate onSubmit={submit} aria-busy={upload.isPending}>
    <TextInput label="Название встречи" id="audio-title" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={upload.isPending} />
    <Select label="Основной язык записи" description="Для смешанной речи выберите авто: қазақша, русский и English в одном разговоре." id="audio-language" value={language} onChange={(value) => { if (value) setLanguage(value) }} disabled={upload.isPending}
      data={[{ value: 'auto', label: 'Авто · Қазақша / Русский / English' }, { value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'en', label: 'English' }]} />
    <Select label="Сколько участников в записи" description="Если число известно, укажите его: авто может разделить один голос на несколько." value={speakers} onChange={(value) => { if (value) setSpeakers(value) }} disabled={upload.isPending}
      data={[{ value: 'auto', label: 'Определить автоматически' }, ...Array.from({ length: 32 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]} />
    <FileInput label="Аудиозапись встречи" id="audio-file" placeholder="Выбрать файл" description="MP3, WAV или M4A · до 100 МБ · до 2 часов"
      accept=".mp3,.wav,.m4a" leftSection={<Upload size={18} aria-hidden="true" />} value={file} onChange={(value) => { setFile(value); if (!title.trim() && value) setTitle(value.name.replace(/\.[^.]+$/, '').slice(0, 200)); setValidation('') }}
      disabled={upload.isPending} clearable clearButtonProps={{ 'aria-label': 'Убрать выбранный файл' }} />
    {validation && <InlineError>{validation}</InlineError>}
    {upload.isError && <InlineError>{errorMessage(upload.error, 'Не удалось загрузить аудио. Файл остался выбранным — попробуйте ещё раз.')}</InlineError>}
    <div className="form-actions"><Button type="submit" loading={upload.isPending}>{upload.isPending ? 'Загружаем аудио…' : 'Распознать запись'}</Button></div>
  </form>
}
