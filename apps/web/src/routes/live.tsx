import { useLiveEntrance } from '../components/live/use-live-entrance'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, Select, Stack, Text, TextInput } from '@mantine/core'
import { ArrowRight, Mic } from 'lucide-react'
import { liveApi, liveError, saveGrant } from '../lib/live'
import { PageHeading, InlineError, LoadingState } from '../components/ui'
import { LiveConnecting } from '../components/live/live-connecting'
import '../components/live/live.css'

export function LivePage() {
  const navigate = useNavigate()
  const entering = useLiveEntrance()
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('auto')
  const [validation, setValidation] = useState('')
  const rooms = useQuery({ queryKey: ['live', 'list'], queryFn: liveApi.list, refetchInterval: 5000 })
  const create = useMutation({ mutationFn: liveApi.create, onSuccess: async (grant) => {
    saveGrant(grant, true)
    await navigate({ to: '/live/$roomId', params: { roomId: grant.room_id }, search: { view: 'insights' } })
  } })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) { setValidation('Назовите встречу.'); return }
    setValidation(''); create.mutate({ title: title.trim(), language })
  }
  if (entering && !rooms.isError) return <LiveConnecting title="Готовим пространство" description="Для вашего следующего разговора" />
  if (create.isPending) return <LiveConnecting title="Создаём комнату" description="Скоро можно будет пригласить участников" roomTitle={title} />
  return <div className="page live-entry live-reveal">
    <header className="page-header"><PageHeading title="Live" /></header>
    <section className="form-panel live-start-panel">
      <div className="live-start-icon"><Mic size={25} /></div>
      <Text component="h2" className="live-start-title">Начните разговор</Text>
      <Text c="dimmed">Пригласите участников в голосовую комнату. Стенограмма и итоги появятся во время встречи.</Text>
      <form onSubmit={submit} className="meeting-form">
        <TextInput label="Название встречи" placeholder="Что будем обсуждать?" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} error={validation} disabled={create.isPending} />
        <Select label="Язык разговора" value={language} onChange={(v) => setLanguage(v ?? 'auto')} data={[{ value: 'auto', label: 'Определять автоматически' }, { value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }, { value: 'en', label: 'English' }]} disabled={create.isPending} />
        <Text size="sm" c="dimmed">Звук распознаётся локально. Текст разговора передаётся в OpenAI для подготовки итогов.</Text>
        {create.isError && <InlineError>{liveError(create.error)}</InlineError>}
        <Button type="submit" leftSection={<Mic size={18} />} loading={create.isPending}>Начать</Button>
      </form>
    </section>
    <section className="live-history" aria-label="Голосовые встречи">
      <Text component="h2" fw={600} size="lg">Ваши голосовые встречи</Text>
      {rooms.isPending ? <LoadingState /> : rooms.isError ? <InlineError>{liveError(rooms.error)}</InlineError> : <Stack gap="sm">
        {rooms.data.length === 0 && <Text c="dimmed">Здесь появятся начатые встречи.</Text>}
        {rooms.data.map((room) => <Card key={room.id} withBorder radius="md" padding={0}><Link to="/live/$roomId" params={{ roomId: room.id }} search={{ view: 'insights' }} className="live-history-row">
          <span><Text fw={500}>{room.title}</Text><Badge color={room.status === 'active' ? 'forest' : 'gray'} variant="light">{room.status === 'active' ? 'Встреча идёт' : room.status === 'ending' ? 'Сохраняем разговор' : 'Завершена'}</Badge></span><ArrowRight size={19} />
        </Link></Card>)}
      </Stack>}
    </section>
  </div>
}
