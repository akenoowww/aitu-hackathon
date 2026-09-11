import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Group, Progress, Tabs, Text } from '@mantine/core'
import { AudioLines, Check, FileText, Sparkles } from 'lucide-react'
import type { MeetingDetail } from '../lib/contracts'
import { boardApi, boardError } from '../lib/board'
import { timestamp } from '../lib/transcription'
import { Transcription } from './transcription'
import { MeetingBoard } from './board/meeting-board'
import { InlineError } from './ui'
import './audio-workspace.css'

export function AudioWorkspace({ meeting }: { meeting: MeetingDetail }) {
  const cache = useQueryClient()
  const [view, setView] = useState<string | null>('conversation')
  const pane = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const processing = ['queued', 'running'].includes(meeting.transcription?.status ?? '')
  const recognized = meeting.transcription?.status === 'succeeded'
  const board = useQuery({ queryKey: ['board', meeting.id], queryFn: ({ signal }) => boardApi.get(meeting.id, signal),
    refetchInterval: (query) => processing || ['queued', 'running'].includes(query.state.data?.status ?? '') ? 1500 : false })
  useEffect(() => { if (recognized) void cache.invalidateQueries({ queryKey: ['board', meeting.id] }) }, [recognized, meeting.id, cache])
  const generation = useMutation({ mutationFn: () => boardApi.generate(meeting.id), onSuccess: (data) => cache.setQueryData(['board', meeting.id], data) })
  const analyzing = ['queued', 'running'].includes(board.data?.status ?? '')
  const complete = recognized && board.data?.status === 'ready'
  const segments = meeting.segments ?? []
  const processedSeconds = segments.at(-1)?.end ?? 0
  const duration = meeting.transcription?.duration_seconds
  useEffect(() => {
    if (following.current && pane.current && view === 'conversation') pane.current.scrollTop = pane.current.scrollHeight
  }, [segments.length, view])
  return <section className="audio-workspace" aria-label="Обработка аудиозаписи">
    <div className="audio-processing-header">
      <div className={`audio-processing-icon ${processing || analyzing ? 'is-processing' : ''}`} aria-hidden="true">{complete ? <Check size={23} /> : <AudioLines size={23} />}</div>
      <div className="audio-processing-copy">
        <Text fw={500} role="status">{processing ? meeting.transcription?.status === 'queued' ? 'Запись в очереди' : 'Распознаём запись' : analyzing ? 'Готовим итоги' : complete ? 'Обработка завершена' : recognized ? 'Запись распознана' : 'Обработка остановлена'}</Text>
        <Text size="sm" c="dimmed">{processing ? `${timestamp(processedSeconds)}${duration ? ` из ${timestamp(duration)}` : ''} · Текст появляется по мере распознавания` : analyzing ? 'Промежуточные выводы появляются во вкладке «Итоги»' : meeting.audio_filename}</Text>
      </div>
      <span className="audio-processing-step">{processing ? '1 / 2' : recognized ? '2 / 2' : ''}</span>
    </div>
    {(processing || analyzing) && <Progress value={processing ? meeting.transcription?.progress ?? 0 : board.data?.progress ?? 0} aria-label={processing ? 'Распознавание записи' : 'Подготовка итогов'} size={3} />}
    <div className="audio-source"><audio controls preload="none" aria-label="Аудиозапись встречи" src={`/api/v1/meetings/${encodeURIComponent(meeting.id)}/audio`} /></div>
    <Transcription meeting={meeting} compact />
    <Tabs value={view} onChange={setView} className="audio-workspace-tabs">
      <Tabs.List>
        <Tabs.Tab value="conversation" leftSection={<FileText size={17} />}>Разговор{segments.length ? ` · ${segments.length}` : ''}</Tabs.Tab>
        <Tabs.Tab value="insights" leftSection={<Sparkles size={17} />}>Итоги</Tabs.Tab>
        {board.data?.status === 'ready' && <Tabs.Tab value="board">Доска</Tabs.Tab>}
      </Tabs.List>
    </Tabs>
    {board.isError && <InlineError>{boardError(board.error)} <Button variant="subtle" onClick={() => void board.refetch()}>Повторить загрузку итогов</Button></InlineError>}
    {view === 'conversation' && <div className="audio-transcript-feed" ref={pane} onScroll={(event) => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
      {segments.length ? segments.map((segment, index) => <article key={`${index}-${segment.start}`} className="audio-transcript-segment">
        <time>{timestamp(segment.start)}</time><p>{segment.text}</p>
      </article>) : meeting.transcript ? <div className="transcript-text" data-testid="transcript">{meeting.transcript}</div> : <div className="audio-feed-empty"><AudioLines size={28} /><Text fw={500}>{processing ? 'Здесь появится разговор' : 'Пока нет распознанных фрагментов'}</Text><Text size="sm" c="dimmed">{processing ? 'Можно читать первые фрагменты, пока остальная запись обрабатывается.' : 'Запись можно распознать повторно.'}</Text></div>}
      {processing && segments.length > 0 && <Text className="audio-feed-continuation" size="sm" c="dimmed">Продолжаем распознавать…</Text>}
    </div>}
    {view === 'insights' && <div className="audio-insights-feed">
      {analyzing && <Text size="sm" c="dimmed" mb="md">Промежуточные выводы. Они могут уточниться после анализа всей записи.</Text>}
      {board.data?.status === 'failed' && <InlineError>{boardError(board.data.error_code)} Промежуточные выводы могут быть неполными.</InlineError>}
      {board.data?.summary.map((item, index) => <article className="audio-insight" key={`${index}-${item.text}`}><Sparkles size={19} aria-hidden="true" /><div><Text>{item.text}</Text><details><summary>Фрагмент разговора</summary><blockquote>{item.quote}</blockquote></details></div></article>)}
      {!board.data?.summary.length && <div className="audio-feed-empty"><Sparkles size={28} /><Text fw={500}>{processing ? 'Сначала распознаем разговор' : analyzing ? 'Анализируем первые фрагменты' : board.data?.status === 'ready' ? 'В записи нет содержательных итогов' : 'Итогов пока нет'}</Text><Text size="sm" c="dimmed">{processing ? 'После распознавания начнётся подготовка итогов.' : analyzing ? 'Выводы появятся здесь по мере анализа.' : 'Здесь будут основные темы и договорённости.'}</Text></div>}
      {recognized && board.data && ['idle', 'failed'].includes(board.data.status) && <Button loading={generation.isPending} onClick={() => generation.mutate()}>{board.data.status === 'failed' ? 'Повторить анализ' : 'Подготовить итоги'}</Button>}
      {generation.isError && <InlineError>{boardError(generation.error)}</InlineError>}
      {board.data?.status === 'ready' && board.data.cards.length > 0 && <Group mt="lg"><Button variant="light" onClick={() => setView('board')}>Открыть решения и поручения · {board.data.cards.length}</Button></Group>}
    </div>}
    {view === 'board' && <MeetingBoard meetingId={meeting.id} title={meeting.title} meeting={meeting} canGenerate={recognized} />}
  </section>
}
