import { useMutation } from '@tanstack/react-query'
import { Button, Progress, Text } from '@mantine/core'
import { api, errorMessage } from '../lib/api'
import type { MeetingDetail } from '../lib/contracts'
import { meetingQuery, queryClient } from '../lib/query'
import { InlineError } from './ui'
import './transcription.css'

const errors: Record<string, string> = {
  model_missing: 'Распознавание ещё не настроено. Установите локальную модель по инструкции запуска и повторите попытку.',
  invalid_audio: 'Не удалось прочитать аудио. Проверьте, что запись воспроизводится, и загрузите её в формате MP3, WAV или M4A.',
  audio_too_long: 'Запись длиннее 2 часов. Разделите её на части и загрузите снова.',
  no_speech: 'В записи не удалось обнаружить речь. Проверьте громкость и выбранный язык.',
  source_changed: 'Исходная запись изменилась. Загрузите файл заново.',
  model_changed: 'Модель распознавания изменилась. Повторите попытку.',
  transcript_too_long: 'Стенограмма превышает допустимый объём. Разделите запись на части.',
  processing_timeout: 'Распознавание заняло слишком много времени. Попробуйте запись меньшей длительности.',
  worker_interrupted: 'Распознавание прервалось. Запись сохранена — можно повторить попытку.',
}
export function Transcription({ meeting, compact = false }: { meeting: MeetingDetail; compact?: boolean }) {
  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'retry') => kind === 'cancel' ? api.cancelTranscription(meeting.id) : api.retryTranscription(meeting.id),
    onSuccess: async (result) => {
      queryClient.setQueryData(meetingQuery(meeting.id).queryKey, result)
      await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
    },
  })
  const job = meeting.transcription
  if (!job) return null
  const active = job.status === 'queued' || job.status === 'running'
  if (compact && job.status === 'succeeded') return null
  return <section className="transcription-state" aria-label="Распознавание аудио">
    {!compact && <Text size="sm" className="audio-filename">{meeting.audio_filename}</Text>}
    {active && <>
      {!compact && <Text size="sm" role="status">{job.status === 'queued' ? 'Запись ожидает распознавания. Можно вернуться к ней позже.' : `Распознаём запись · ${job.progress}%`}</Text>}
      {!compact && job.status === 'running' && <Progress size="md" value={job.progress} aria-label="Прогресс распознавания" className="transcription-progress" />}
      <Button variant="default" color="gray" disabled={action.isPending} onClick={() => action.mutate('cancel')}>Отменить распознавание</Button>
    </>}
    {job.status === 'failed' && <InlineError>{errors[job.error_code ?? ''] ?? 'Не удалось распознать запись. Попробуйте ещё раз.'}</InlineError>}
    {job.status === 'cancelled' && <Text size="sm">Распознавание отменено. Запись сохранена.</Text>}
    {(job.status === 'failed' || job.status === 'cancelled') && <Button loading={action.isPending} onClick={() => action.mutate('retry')}>Повторить распознавание</Button>}
    {action.isError && <InlineError>{errorMessage(action.error)}</InlineError>}
  </section>
}
