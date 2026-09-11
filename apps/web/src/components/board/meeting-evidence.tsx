import { useRef, useState } from 'react'
import { Alert, Button, Modal, Text } from '@mantine/core'
import { FileText, Play } from 'lucide-react'
import type { Evidence } from '../../lib/board'
import type { MeetingDetail } from '../../lib/contracts'
import { timestamp } from '../../lib/transcription'

export function EvidenceButton({ evidence, onOpen, label = 'Источник' }: {
  evidence: Evidence; onOpen: (value: Evidence) => void; label?: string
}) {
  const time = evidence.start_seconds
  return <Button variant="subtle" size="compact-xs" leftSection={time !== null ? <Play size={13} /> : <FileText size={13} />}
    onClick={() => onOpen(evidence)}>{label}{time !== null ? ` · ${timestamp(time)}` : ''}</Button>
}

export function MeetingEvidence({ meeting, evidence, onClose }: {
  meeting: MeetingDetail; evidence: Evidence; onClose: () => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [audioError, setAudioError] = useState(false)
  const [ready, setReady] = useState(false)
  const [playError, setPlayError] = useState(false)
  const [playingExcerpt, setPlayingExcerpt] = useState(false)
  // API offsets count Unicode code points, including emoji, not UTF-16 units.
  const characters = Array.from(meeting.transcript)
  const matches = characters.slice(evidence.start_char, evidence.end_char).join('') === evidence.quote
  const hasAudio = matches && meeting.source_type === 'audio' && evidence.start_seconds !== null
  const before = characters.slice(Math.max(0, evidence.start_char - 240), evidence.start_char).join('')
  const after = characters.slice(evidence.end_char, evidence.end_char + 240).join('')
  async function play() {
    const player = audio.current
    if (!player || evidence.start_seconds === null) return
    player.currentTime = evidence.start_seconds
    setPlayError(false)
    setPlayingExcerpt(true)
    try { await player.play() } catch { setPlayingExcerpt(false); setPlayError(true) }
  }
  return <Modal opened onClose={onClose} title="Источник из встречи" size="lg" centered
    closeButtonProps={{ 'aria-label': 'Закрыть источник' }}>
    <div className="meeting-evidence">
      <Text fw={600}>{meeting.title}</Text>
      {!matches ? <Alert color="orange">Этот фрагмент больше не совпадает со стенограммой. Закройте источник и обновите страницу встречи.</Alert> : <>
        {evidence.speaker && <Text size="sm">{evidence.speaker}</Text>}
        <div className="evidence-context" data-testid="evidence-context">
          {evidence.start_char > 240 && '…'}{before}<mark>{evidence.quote}</mark>{after}
          {evidence.end_char + 240 < characters.length && '…'}
        </div>
        {hasAudio && <div className="evidence-audio">
          <Text size="sm">Фрагмент записи: {timestamp(evidence.start_seconds!)}{evidence.end_seconds !== null ? `–${timestamp(evidence.end_seconds)}` : ''}</Text>
          <audio ref={audio} controls preload="metadata" aria-label="Исходная аудиозапись"
            src={`/api/v1/meetings/${encodeURIComponent(meeting.id)}/audio`}
            onLoadedMetadata={() => { setReady(true); if (audio.current) audio.current.currentTime = evidence.start_seconds! }}
            onTimeUpdate={() => { if (playingExcerpt && audio.current && evidence.end_seconds !== null && audio.current.currentTime >= evidence.end_seconds) { audio.current.pause(); setPlayingExcerpt(false) } }}
            onEnded={() => setPlayingExcerpt(false)} onError={() => setAudioError(true)} />
          <Button variant="light" leftSection={<Play size={15} />} disabled={!ready || audioError} onClick={() => void play()}>Прослушать фрагмент</Button>
          {audioError && <Alert color="orange">Не удалось открыть аудиозапись. Цитату можно проверить по стенограмме выше.</Alert>}
          {playError && <Alert color="orange">Не удалось начать воспроизведение. Попробуйте кнопку воспроизведения на аудиоплеере.</Alert>}
        </div>}
      </>}
    </div>
  </Modal>
}
