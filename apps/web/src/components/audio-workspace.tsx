import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Anchor, Button, Group, Progress, Stack, Tabs, Text, Title } from '@mantine/core'
import { ArrowRight, AudioLines, Check, CheckSquare, CircleHelp, Lightbulb, ListChecks, Sparkles, TriangleAlert } from 'lucide-react'
import type { MeetingDetail } from '../lib/contracts'
import { boardApi, boardError, type Card } from '../lib/board'
import { timestamp } from '../lib/transcription'
import { Transcription } from './transcription'
import { MeetingBoard } from './board/meeting-board'
import { MeetingChat } from './rag/meeting-chat'
import { Disclosure, InlineError } from './ui'
import './live/live.css'
import './audio-workspace.css'
import './meeting-workspace.css'

export type MeetingView = 'conversation' | 'insights' | 'kanban'
const noteKinds = {
  task: { label: 'Поручение', icon: CheckSquare },
  decision: { label: 'Решение', icon: Check },
  topic: { label: 'Тема', icon: Lightbulb },
  question: { label: 'Открытый вопрос', icon: CircleHelp },
  risk: { label: 'Риск', icon: TriangleAlert },
}

export function MeetingWorkspace({ meeting, view, onViewChange }: {
  meeting: MeetingDetail; view: MeetingView; onViewChange: (view: MeetingView) => void
}) {
  const cache = useQueryClient()
  const pane = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const following = useRef(true)
  const savedScroll = useRef<Record<MeetingView, number>>({ conversation: 0, insights: 0, kanban: 0 })
  const quoteTarget = useRef<{ quote: string; start?: number } | null>(null)
  const isAudio = meeting.source_type === 'audio'
  const processing = ['queued', 'running'].includes(meeting.transcription?.status ?? '')
  const recognized = isAudio ? meeting.status === 'transcribed' : !!meeting.transcript.trim()
  const board = useQuery({ queryKey: ['board', meeting.id], queryFn: ({ signal }) => boardApi.get(meeting.id, signal),
    refetchInterval: (query) => processing || ['queued', 'running'].includes(query.state.data?.status ?? '') ? 1500 : false })
  useEffect(() => { if (recognized) void cache.invalidateQueries({ queryKey: ['board', meeting.id] }) }, [recognized, meeting.id, cache])
  const generation = useMutation({ mutationFn: () => boardApi.generate(meeting.id), onSuccess: (data) => cache.setQueryData(['board', meeting.id], data) })
  const analyzing = ['queued', 'running'].includes(board.data?.status ?? '')
  const complete = recognized && board.data?.status === 'ready'
  const segments = meeting.segments ?? []
  const processedSeconds = segments.at(-1)?.end ?? 0
  const duration = meeting.transcription?.duration_seconds
  const notes = board.data?.cards.filter((card) => card.status !== 'dismissed') ?? []

  function changeView(next: MeetingView) {
    if (pane.current) savedScroll.current[view] = pane.current.scrollTop
    onViewChange(next)
  }
  function source(quote: string, start?: number) {
    quoteTarget.current = { quote, start }
    changeView('conversation')
  }
  useEffect(() => {
    const element = pane.current
    if (!element) return
    element.scrollTop = savedScroll.current[view]
    const target = quoteTarget.current
    if (view !== 'conversation' || !target) return
    quoteTarget.current = null
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-transcript-segment]'))
    const row = rows.find((node) => target.start !== undefined
      ? Number(node.dataset.start) <= target.start && Number(node.dataset.end) >= target.start
      : node.textContent?.includes(target.quote))
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'instant' })
      row.focus({ preventScroll: true })
    } else {
      const raw = element.querySelector<HTMLElement>('[data-testid="transcript"]')
      raw?.scrollIntoView({ block: 'start', behavior: 'instant' })
      raw?.focus({ preventScroll: true })
    }
    if (target.start !== undefined && audio.current) audio.current.currentTime = target.start
  }, [view])
  useEffect(() => {
    if (processing && following.current && pane.current && view === 'conversation') pane.current.scrollTop = pane.current.scrollHeight
  }, [processing, segments.length, view])
  function noteSource(card: Card) {
    if (card.quote) source(card.quote, card.evidence?.start_seconds ?? undefined)
  }

  return <section className="meeting-workspace" aria-label="Рабочее пространство встречи">
    {isAudio && (processing || analyzing || !recognized) && <div className="meeting-processing no-print">
      <div className="audio-processing-header">
        <div className={`audio-processing-icon ${processing || analyzing ? 'is-processing' : ''}`} aria-hidden="true">{complete ? <Check size={23} /> : <AudioLines size={23} />}</div>
        <div className="audio-processing-copy">
          <Text fw={500} role="status">{processing ? meeting.transcription?.status === 'queued' ? 'Запись в очереди' : 'Распознаём запись' : analyzing ? 'Готовим итоги' : 'Обработка остановлена'}</Text>
          <Text size="sm" c="dimmed">{processing ? `${timestamp(processedSeconds)}${duration ? ` из ${timestamp(duration)}` : ''} · Текст появляется по мере распознавания` : analyzing ? 'Итоги дополняются по мере анализа записи' : meeting.audio_filename}</Text>
        </div>
      </div>
      {(processing || analyzing) && <Progress value={processing ? meeting.transcription?.progress ?? 0 : board.data?.progress ?? 0} aria-label={processing ? 'Распознавание записи' : 'Подготовка итогов'} size={3} />}
      <Transcription meeting={meeting} compact />
    </div>}
    <Tabs value={view} onChange={(value) => { if (value) changeView(value as MeetingView) }} keepMounted={false} className="live-mode-tabs saved-meeting-tabs">
      <Tabs.List justify="center" aria-label="Разделы встречи">
        <Tabs.Tab value="conversation">Разговор</Tabs.Tab>
        <Tabs.Tab value="insights">Итоги</Tabs.Tab>
        <Tabs.Tab value="kanban">Канбан</Tabs.Tab>
      </Tabs.List>
      <div className={`live-focus-pane saved-meeting-pane ${view === 'kanban' ? 'is-kanban' : ''}`} ref={pane}
        onScroll={(event) => { const element = event.currentTarget; savedScroll.current[view] = element.scrollTop; if (view === 'conversation') following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
        <Tabs.Panel value="conversation" className="saved-conversation">
          {isAudio && <div className="audio-source"><audio ref={audio} controls preload="none" aria-label="Аудиозапись встречи" src={`/api/v1/meetings/${encodeURIComponent(meeting.id)}/audio`} /></div>}
          <section aria-label="Стенограмма разговора" data-testid="meeting-conversation">
            {segments.length ? segments.map((segment, index) => <article data-transcript-segment data-start={segment.start} data-end={segment.end} tabIndex={-1} key={`${index}-${segment.start}`} className="live-utterance saved-utterance">
              <Text size="sm" c="dimmed" component="time">{timestamp(segment.start)}</Text><Text className="live-utterance-text">{segment.text}</Text>
            </article>) : meeting.transcript ? <div className="live-utterance-text saved-transcript" data-testid="transcript" tabIndex={-1}>{meeting.transcript}</div> : <div className="live-empty"><AudioLines size={28} aria-hidden="true" /><Title order={2}>Здесь появится разговор</Title><Text c="dimmed">{processing ? 'Первые реплики появятся по мере распознавания записи.' : 'Распознайте запись, чтобы прочитать стенограмму.'}</Text></div>}
            {processing && segments.length > 0 && <Text className="audio-feed-continuation" size="sm" c="dimmed">Продолжаем распознавать…</Text>}
          </section>
        </Tabs.Panel>
        <Tabs.Panel value="insights" className="saved-insights">
          {board.isPending && <Text role="status">Загружаем итоги…</Text>}
          {board.isError && <InlineError>{boardError(board.error)} <Button variant="subtle" onClick={() => void board.refetch()}>Повторить загрузку итогов</Button></InlineError>}
          {!board.isError && board.data && <>
            {analyzing && <Text size="sm" c="dimmed" mb="md">Готовим итоги встречи. Промежуточные выводы могут уточняться.</Text>}
            {board.data.status === 'failed' && <InlineError>{boardError(board.data.error_code)} Промежуточные выводы могут быть неполными.</InlineError>}
            {board.data.summary.length > 0 && <section className="meeting-summary" aria-label="Краткая выжимка"><Text className="live-note-kind">Кратко о встрече</Text>
              {board.data.summary.map((item, index) => <div className="meeting-summary-item" key={index}><Text>{item.text}</Text><Anchor component="button" className="live-source-link" onClick={() => source(item.quote, item.evidence?.start_seconds ?? undefined)}>К разговору<ArrowRight size={15} aria-hidden="true" /></Anchor></div>)}
            </section>}
            <Stack gap="md">{notes.map((card) => {
              const kind = noteKinds[card.kind]; const Icon = kind.icon
              return <article className="live-note" key={card.id}><div className="live-note-icon"><Icon size={24} aria-hidden="true" /></div><div className="live-note-copy"><Text className="live-note-kind">{kind.label}</Text><Text className="live-note-text">{card.title}</Text>{card.description && <Text size="sm" c="dimmed" mt="xs">{card.description}</Text>}</div>
                {card.quote && <Anchor component="button" className="live-source-link" onClick={() => noteSource(card)}>К разговору<ArrowRight size={17} aria-hidden="true" /></Anchor>}
              </article>
            })}</Stack>
            {!board.data.summary.length && !notes.length && <div className="live-empty"><Sparkles size={29} aria-hidden="true" /><Title order={2}>{processing ? 'Сначала распознаем разговор' : analyzing ? 'Готовим первые итоги' : 'Итогов пока нет'}</Title><Text c="dimmed">Здесь появятся темы, решения, поручения и открытые вопросы встречи.</Text></div>}
            {recognized && ['idle', 'failed'].includes(board.data.status) && <Group justify="center" mt="lg"><Button loading={generation.isPending} onClick={() => generation.mutate()}>{board.data.status === 'failed' ? 'Повторить анализ' : 'Подготовить итоги'}</Button></Group>}
            {generation.isError && <InlineError>{boardError(generation.error)}</InlineError>}
            {notes.some((card) => card.kind === 'task') && <Group justify="center" mt="lg"><Button variant="light" leftSection={<ListChecks size={18} />} onClick={() => changeView('kanban')}>К поручениям в канбане</Button></Group>}
          </>}
          {recognized && <Disclosure label="Задать вопрос по встрече" className="saved-meeting-chat"><MeetingChat meetingId={meeting.id} /></Disclosure>}
        </Tabs.Panel>
        <Tabs.Panel value="kanban" className="saved-kanban">
          <MeetingBoard key={`kanban-${meeting.id}`} embedded meetingId={meeting.id} title={meeting.title} meeting={meeting} canGenerate={recognized} />
        </Tabs.Panel>
      </div>
    </Tabs>
  </section>
}
