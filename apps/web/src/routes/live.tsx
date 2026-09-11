import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, Stack, Text } from '@mantine/core'
import { ArrowRight, Plus, Radio } from 'lucide-react'
import { liveApi, liveError, saveGrant } from '../lib/live'
import { PageHeading, InlineError, LoadingState } from '../components/ui'
import { LiveConnecting } from '../components/live/live-connecting'
import { useLiveEntrance } from '../components/live/use-live-entrance'
import '../components/live/live.css'

export function LivePage() {
  const navigate = useNavigate()
  const entering = useLiveEntrance()
  const rooms = useQuery({ queryKey: ['live', 'list'], queryFn: liveApi.list, refetchInterval: 5000 })
  const create = useMutation({ mutationFn: liveApi.create, onSuccess: async (grant) => {
    saveGrant(grant, true)
    await navigate({ to: '/live/$roomId', params: { roomId: grant.room_id }, search: { view: 'insights' } })
  } })
  function startConversation() {
    if (create.isPending) return
    const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date())
    create.mutate({ title: `Разговор · ${date}`, language: 'auto' })
  }
  if (entering && !rooms.isError) return <LiveConnecting title="Готовим пространство" description="Для вашего следующего разговора" />
  if (create.isPending) return <LiveConnecting title="Создаём комнату" description="Скоро можно будет пригласить участников" roomTitle={create.variables?.title} />
  return <div className="page live-entry live-reveal">
    <header className="page-header">
      <PageHeading title="Live" />
      <Button leftSection={<Plus size={18} aria-hidden="true" />} onClick={startConversation}>Новый разговор</Button>
    </header>
    {create.isError && <InlineError>{liveError(create.error)}</InlineError>}
    <section className="live-history" aria-label="Голосовые встречи">
      {rooms.isPending ? <LoadingState /> : rooms.isError ? <InlineError>{liveError(rooms.error)}</InlineError> : <Stack gap="xs">
        {rooms.data.length === 0 && <div className="live-history-empty"><Radio size={24} aria-hidden="true" /><Text c="dimmed">Здесь появятся ваши разговоры</Text></div>}
        {rooms.data.map((room) => <Card key={room.id} withBorder radius="md" padding={0}><Link to="/live/$roomId" params={{ roomId: room.id }} search={{ view: 'insights' }} className="live-history-row">
          <span className="live-history-icon"><Radio size={20} aria-hidden="true" /></span>
          <span className="live-history-copy"><Text fw={500}>{room.title}</Text><Badge color={room.status === 'active' ? 'forest' : 'gray'} variant="light" tt="none">{room.status === 'active' ? 'Встреча идёт' : room.status === 'ending' ? 'Сохраняем разговор' : 'Завершена'}</Badge></span><ArrowRight size={18} aria-hidden="true" />
        </Link></Card>)}
      </Stack>}
    </section>
    <Text size="xs" c="dimmed" className="live-data-note">Звук распознаётся локально. Текст разговора передаётся в OpenAI для подготовки итогов.</Text>
  </div>
}
