import { useLiveEntrance } from './use-live-entrance'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ActionIcon, Anchor, Avatar, Button, Group, Modal, Stack, Tabs, Text, TextInput, Title } from '@mantine/core'
import { ArrowRight, Check, CheckSquare, Lightbulb, LogOut, Mic, MicOff, Plus, Target, CircleHelp } from 'lucide-react'
import type { Room, Participant, RemoteTrack } from 'livekit-client'
import { Brand, InlineError } from '../ui'
import { captureMicrophone, formatTime, liveApi, liveError, mediaUrl, saveGrant, transcriptRetryDelay, type LiveGrant, type LiveState } from '../../lib/live'
import { pageTitle } from '../../brand'
import { LiveConnecting } from './live-connecting'
import './live.css'

type Peer = { id: string; name: string; speaking: boolean; muted: boolean }
type Mode = 'conversation' | 'insights'
const noteKinds = { goal: { label: 'Цель', icon: Target }, idea: { label: 'Идея', icon: Lightbulb }, decision: { label: 'Решение', icon: Check }, task: { label: 'Поручение', icon: CheckSquare }, question: { label: 'Вопрос', icon: CircleHelp } }
const analysisErrors: Record<string, string> = {
  OPENAI_KEY_REQUIRED: 'Анализ текста ещё не настроен. Добавьте ключ OpenAI в настройки установки.',
  PROVIDER_REJECTED: 'Сервис анализа отклонил запрос. Проверьте ключ и выбранную модель.',
  PROVIDER_RATE_LIMIT: 'Сервис анализа временно ограничил запросы. Можно повторить немного позже.',
  PROVIDER_TIMEOUT: 'Анализ не успел ответить. Разговор и стенограмма продолжаются.',
  UNSUPPORTED_INSIGHT: 'Выводы не удалось подтвердить репликами. Предыдущие итоги сохранены.',
}

export function RoomWorkspace({ grant, data, view, focus, onMode, onLeave, syncFailed, onRetrySync }: {
  grant: LiveGrant; data: LiveState; view: Mode; focus?: string;
  onMode: (mode: Mode, focus?: string) => void; onLeave: () => void; syncFailed?: boolean; onRetrySync?: () => void;
}) {
  const entering = useLiveEntrance()
  const rtc = useRef<Room | null>(null)
  const mediaSDK = useRef<typeof import('livekit-client') | null>(null)
  const audioElements = useRef<HTMLDivElement>(null)
  const stopCapture = useRef<(() => Promise<void>) | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const scroll = useRef<{ conversation: number | null; insights: number }>({ conversation: null, insights: 0 })
  const lastMode = useRef<Mode | null>(null)
  const appliedFocus = useRef<string | null>(null)
  const followConversation = useRef(true)
  const [peers, setPeers] = useState<Peer[]>([])
  const [connection, setConnection] = useState('connecting')
  const [mic, setMic] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [audioError, setAudioError] = useState('')
  const [reconnect, setReconnect] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const active = data.status === 'active'
  const grantRef = useRef(grant)
  const fullTranscript = useQuery({ queryKey: ['live', 'transcript', grant.room_id, grant.participant_id], enabled: view === 'conversation', queryFn: async ({ signal }) => {
    const result = []
    for (let offset = 0; offset <= 20000; offset += 300) {
      const page = await liveApi.transcript(grantRef.current, offset, signal)
      result.push(...page)
      if (page.length < 300) break
    }
    return result
  }, staleTime: 10000,
  retry: (failures, error) => failures < 1 && transcriptRetryDelay(error, failures) !== false,
  refetchInterval: (query) => query.state.status === 'error' ? transcriptRetryDelay(query.state.error, query.state.errorUpdateCount) : false })
  const utterances = useMemo(() => {
    const result = new Map((fullTranscript.data ?? []).map((row) => [row.id, row]))
    for (const row of data.utterances) result.set(row.id, row)
    return [...result.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  }, [fullTranscript.data, data.utterances])
  const byId = useMemo(() => new Map(utterances.map((row) => [row.id, row])), [utterances])
  const stopAudio = useCallback(async () => {
    const stop = stopCapture.current
    stopCapture.current = null
    if (stop) await stop()
  }, [])
  useEffect(() => { document.title = pageTitle(data.title) }, [data.title])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!active) return
    let disposed = false
    let closingClient: Room | null = null
    const audioContainer = audioElements.current
    void (async () => {
      try {
        const module = await import('livekit-client')
        if (disposed) return
        mediaSDK.current = module
        const { Room, RoomEvent, Track } = module
        const client = new Room({ singlePeerConnection: false, adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true })
        closingClient = client
        rtc.current = client
        const sync = () => {
          if (disposed) return
          const people: Participant[] = [client.localParticipant, ...client.remoteParticipants.values()]
          setPeers(people.filter((p) => !!p.identity).map((p) => ({ id: p.identity, name: p.name || 'Участник', speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled })))
          setMic(client.localParticipant.isMicrophoneEnabled)
        }
        const startCapture = async () => {
          const track = client.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
          if (!track || !client.localParticipant.isMicrophoneEnabled || disposed) return
          try {
            const stop = await captureMicrophone(track.mediaStreamTrack, grantRef.current, (message) => { if (!disposed) setAudioError(message) })
            if (disposed) await stop(); else stopCapture.current = stop
          } catch { if (!disposed) setAudioError('Не удалось подключить распознавание. Выключите и включите микрофон, чтобы повторить.') }
        }
        const attach = (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio && !disposed) {
            const element = track.attach(); element.setAttribute('data-remote-audio', 'true')
            audioContainer?.append(element)
          }
        }
        client.on(RoomEvent.TrackSubscribed, attach)
        client.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()))
        client.on(RoomEvent.ParticipantConnected, sync).on(RoomEvent.ParticipantDisconnected, sync)
          .on(RoomEvent.ActiveSpeakersChanged, sync).on(RoomEvent.TrackMuted, sync).on(RoomEvent.TrackUnmuted, sync)
          .on(RoomEvent.LocalTrackPublished, sync).on(RoomEvent.LocalTrackUnpublished, sync)
        client.on(RoomEvent.Reconnecting, () => { if (!disposed) { setConnection('reconnecting'); void stopAudio() } })
        client.on(RoomEvent.Reconnected, () => { if (!disposed) { setConnection('connected'); sync(); void startCapture() } })
        client.on(RoomEvent.Disconnected, () => { if (!disposed) { setConnection('disconnected'); setMic(false); void stopAudio() } })
        const fresh = await liveApi.refresh(grantRef.current)
        if (disposed) return
        grantRef.current = fresh; saveGrant(fresh)
        await client.connect(mediaUrl(fresh.media_url), fresh.media_token, { autoSubscribe: true })
        if (disposed) { await client.disconnect(); return }
        setConnection('connected'); sync()
        await client.startAudio()
        try { await client.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, channelCount: 1 }); sync(); await startCapture() }
        catch { if (!disposed) setMediaError('Разрешите доступ к микрофону, чтобы говорить. Других участников можно слушать.') }
      } catch {
        if (!disposed) {
          setConnection('disconnected')
          setMediaError(mediaSDK.current ? 'Не удалось подключить голосовую связь. Проверьте соединение и попробуйте снова.' : 'В этом браузере не удалось включить голосовую связь. Стенограмма и итоги доступны.')
        }
      }
    })()
    return () => {
      disposed = true
      void stopAudio().finally(() => closingClient?.disconnect())
      rtc.current = null
      audioContainer?.replaceChildren()
    }
  }, [active, grant.room_id, grant.participant_id, reconnect, stopAudio])
  useLayoutEffect(() => {
    const element = pane.current
    if (!element) return
    if (focus && view === 'conversation' && appliedFocus.current !== focus) {
      const target = element.querySelector(`[data-utterance-id="${focus}"]`)
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'instant' }); appliedFocus.current = focus; followConversation.current = false }
    } else if (lastMode.current !== view) {
      element.scrollTop = scroll.current[view] ?? element.scrollHeight
    } else if (view === 'conversation' && !focus && followConversation.current) {
      element.scrollTop = element.scrollHeight
    }
    lastMode.current = view
  }, [view, focus, utterances.length])
  const invite = useMutation({ mutationFn: () => liveApi.invite(grantRef.current), onSuccess: ({ invite }) => {
    setInviteLink(`${location.origin}/live/${grant.room_id}#invite=${encodeURIComponent(invite)}`); setInviteOpen(true); setCopied(false)
  } })
  const end = useMutation({ mutationFn: async () => { await stopAudio(); return liveApi.end(grantRef.current) }, onSuccess: () => { setEndOpen(false); void rtc.current?.disconnect() } })
  const retryAnalysis = useMutation({ mutationFn: () => liveApi.retryAnalysis(grantRef.current) })
  async function toggleMic() {
    const client = rtc.current
    const source = mediaSDK.current?.Track.Source.Microphone
    if (!client || !source || micBusy) return
    setMicBusy(true); setMediaError(''); setAudioError('')
    try {
      if (client.localParticipant.isMicrophoneEnabled) { await stopAudio(); await client.localParticipant.setMicrophoneEnabled(false) }
      else {
        await client.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, channelCount: 1 })
        const track = client.localParticipant.getTrackPublication(source)?.track
        if (track) stopCapture.current = await captureMicrophone(track.mediaStreamTrack, grantRef.current, setAudioError)
      }
      setMic(client.localParticipant.isMicrophoneEnabled)
    } catch { setMediaError('Не удалось включить микрофон или распознавание. Проверьте разрешение браузера и повторите.') }
    finally { setMicBusy(false) }
  }
  function changeMode(mode: Mode, target?: string) {
    if (pane.current) scroll.current[view] = pane.current.scrollTop
    if (target) appliedFocus.current = null
    onMode(mode, target)
  }
  const elapsed = (data.ended_at ? Date.parse(data.ended_at) : now) - Date.parse(data.created_at)
  const shownPeers = active ? peers : data.participants.map((p) => ({ id: p.id, name: p.name, speaking: false, muted: true }))
  const status = data.status === 'ended' ? 'Встреча завершена' : data.status === 'ending' ? 'Сохраняем последние реплики' : connection === 'connected' ? 'Встреча идёт' : connection === 'reconnecting' ? 'Восстанавливаем связь' : connection === 'connecting' ? 'Подключаемся' : 'Связь прервана'
  const connecting = active && connection !== 'disconnected' && (entering || connection === 'connecting')
  return <div className="live-room-shell">
    {connecting && <LiveConnecting roomTitle={data.title} />}
    <div className={connecting ? 'live-workspace-pending' : 'live-reveal'} inert={connecting} aria-hidden={connecting || undefined}>
    {!grant.is_host && <header className="live-topbar"><Brand /></header>}
    <div className="live-room-main">
      <section className="live-room-heading">
        <div><Title order={1}>{data.title}</Title><Text className="live-status" c="dimmed"><span className={active && connection === 'connected' ? 'live-status-dot active' : 'live-status-dot'} />{status} · {formatTime(elapsed / 1000)}</Text></div>
        {shownPeers.length > 0 && <div className="live-people" aria-label="Участники голосовой встречи">{shownPeers.map((peer) => <div className={`live-person ${peer.speaking ? 'is-speaking' : ''}`} key={peer.id}><Avatar size={36} radius="xl" color="forest">{peer.name.slice(0, 1).toUpperCase()}</Avatar><Text size="sm" fw={500}>{peer.name}{peer.id === grant.participant_id ? ' (вы)' : ''}</Text>{peer.speaking && <Text size="xs" c="dimmed">Говорит</Text>}</div>)}</div>}
        <Group className="live-room-actions" gap="sm">
          {active && <ActionIcon className="live-mic-button" size={42} variant="light" radius="md" color={mic ? 'forest' : 'gray'} onClick={() => void toggleMic()} disabled={connection !== 'connected'} loading={micBusy} aria-pressed={mic} aria-label={mic ? 'Выключить микрофон' : 'Включить микрофон'} title={mic ? 'Выключить микрофон' : 'Включить микрофон'}>{mic ? <Mic size={20} /> : <MicOff size={20} />}</ActionIcon>}
          {grant.is_host && active && <><Button variant="default" leftSection={<Plus size={17} />} loading={invite.isPending} onClick={() => invite.mutate()}>Пригласить</Button><Button onClick={() => setEndOpen(true)}>Завершить</Button></>}
          {!grant.is_host && <Button variant="default" leftSection={<LogOut size={17} />} onClick={() => { void stopAudio().finally(() => { void rtc.current?.disconnect(); onLeave() }) }}>Выйти</Button>}
        </Group>
      </section>
      {(mediaError || audioError || data.audio_error) && <InlineError>{mediaError || audioError || 'Распознавание прервалось. Некоторые реплики могли не сохраниться.'}{connection === 'disconnected' && active && <Button variant="subtle" onClick={() => { if (!mediaSDK.current) { location.reload(); return } setMediaError(''); setConnection('connecting'); setReconnect((value) => value + 1) }}>Подключиться снова</Button>}</InlineError>}
      {syncFailed && <InlineError>Не удалось обновить стенограмму и итоги. <Button variant="subtle" onClick={onRetrySync}>Обновить данные</Button></InlineError>}
      {invite.isError && <InlineError>{liveError(invite.error)}</InlineError>}
      <Tabs value={view} onChange={(value) => changeMode(value as Mode)} keepMounted={false} className="live-mode-tabs"><Tabs.List justify="center"><Tabs.Tab value="conversation">Разговор</Tabs.Tab><Tabs.Tab value="insights">Итоги</Tabs.Tab></Tabs.List></Tabs>
      <div ref={pane} className="live-focus-pane" onScroll={(event) => { const el = event.currentTarget; scroll.current[view] = el.scrollTop; if (view === 'conversation') followConversation.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80 }}>
        {view === 'insights' ? <section aria-label="Итоги встречи" data-testid="live-insights">
          {data.analysis_status === 'failed' && <div className="live-notice"><InlineError>{analysisErrors[data.analysis_error ?? ''] ?? 'Не удалось обновить итоги. Предыдущие выводы сохранены; стенограмма продолжается.'}</InlineError>{grant.is_host && <Button variant="subtle" loading={retryAnalysis.isPending} onClick={() => retryAnalysis.mutate()}>Повторить анализ</Button>}</div>}
          {data.insights.length === 0 ? <div className="live-empty"><Target size={29} /><Title order={2}>Итогов пока нет</Title><Text c="dimmed">Когда прозвучат цели, идеи и договорённости, они появятся здесь. Стенограмма доступна во вкладке «Разговор».</Text></div> : <Stack gap="lg">{data.insights.map((note, index) => {
            const kind = noteKinds[note.kind]; const Icon = kind.icon; const source = byId.get(note.source_ids[0]);
            return <article className="live-note" key={`${note.kind}-${index}`}><div className="live-note-icon"><Icon size={24} /></div><div className="live-note-copy"><Text className="live-note-kind">{kind.label}</Text><Text className="live-note-text">{note.text}</Text></div><Anchor component="button" className="live-source-link" onClick={() => changeMode('conversation', note.source_ids[0])}>{source ? `${source.speaker} · ${formatTime(source.start)}` : 'К исходной реплике'}<ArrowRight size={17} /></Anchor></article>
          })}</Stack>}
        </section> : <section aria-label="Стенограмма разговора" data-testid="live-transcript">
          {fullTranscript.isError && <InlineError>Не удалось загрузить ранние реплики. {transcriptRetryDelay(fullTranscript.error, 1) !== false ? 'Повторим загрузку автоматически.' : liveError(fullTranscript.error)} <Button variant="subtle" loading={fullTranscript.isFetching} onClick={() => void fullTranscript.refetch()}>Повторить</Button></InlineError>}
          {utterances.length === 0 ? <div className="live-empty"><Mic size={29} /><Title order={2}>{connection === 'connected' ? 'Слушаем разговор' : 'Пока нет реплик'}</Title><Text c="dimmed">{connection === 'connected' ? 'Реплики появятся после коротких пауз в речи. Пока можно пригласить участников.' : 'Подключитесь к голосовой связи, чтобы продолжить разговор.'}</Text></div> : utterances.map((row) => <article data-utterance-id={row.id} className={`live-utterance ${focus === row.id ? 'focused' : ''}`} key={row.id}><Group gap="sm"><Text fw={600}>{row.speaker}</Text><Text size="sm" c="dimmed">{formatTime(row.start)}</Text></Group><Text className="live-utterance-text">{row.text}</Text></article>)}
        </section>}
      </div>
      {data.status === 'ended' && data.meeting_id && grant.is_host && <Anchor renderRoot={(props) => <Link {...props} to="/meetings/$meetingId" params={{ meetingId: data.meeting_id! }} />}>Открыть сохранённую встречу</Anchor>}
    </div>
    </div>
    <div ref={audioElements} aria-hidden="true" className="live-audio-elements" />
    <Modal opened={inviteOpen} onClose={() => setInviteOpen(false)} title="Пригласить в разговор" centered><Stack><Text size="sm" c="dimmed">По этой ссылке участники смогут войти в голосовую комнату и увидеть её разговор и итоги.</Text>{['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && <Text size="sm" c="dimmed">Сейчас ссылка открывается только на этом компьютере. Для других устройств приложению нужен общий адрес.</Text>}<TextInput aria-label="Ссылка на встречу" value={inviteLink} readOnly onFocus={(event) => event.currentTarget.select()} /><Button onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setCopied(true)).catch(() => setCopied(false)) }}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</Button></Stack></Modal>
    <Modal opened={endOpen} onClose={() => { if (!end.isPending) setEndOpen(false) }} title="Завершить встречу?" centered><Stack><Text>Голосовая связь завершится для всех. Стенограмма и итоги сохранятся.</Text>{end.isError && <InlineError>{liveError(end.error)}</InlineError>}<Group justify="flex-end"><Button variant="default" disabled={end.isPending} onClick={() => setEndOpen(false)}>Продолжить встречу</Button><Button color="red" loading={end.isPending} onClick={() => end.mutate()}>Завершить для всех</Button></Group></Stack></Modal>
  </div>
}
