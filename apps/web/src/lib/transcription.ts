import type { MeetingSummary } from './contracts'

export function meetingStatus(meeting: MeetingSummary): string {
  const status = meeting.transcription?.status
  if (status === 'queued') return 'Ожидает распознавания'
  if (status === 'running') return 'Распознаём запись'
  if (status === 'failed') return 'Не удалось распознать'
  if (status === 'cancelled') return 'Распознавание отменено'
  return meeting.status === 'transcribed' ? 'Стенограмма готова' : 'Черновик'
}
export function timestamp(seconds: number) {
  const value = Math.floor(seconds)
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`
}
