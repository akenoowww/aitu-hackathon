import { useRef, useState } from 'react'
import { MeetingChat } from '../components/rag/meeting-chat'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Anchor, Badge, Button, Modal, Text, Title } from '@mantine/core'
import { ArrowLeft, Info, Trash2 } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import { meetingQuery, queryClient } from '../lib/query'
import { Disclosure, ErrorState, InlineError, LoadingState, PageHeading } from '../components/ui'
import { Transcription } from '../components/transcription'
import { meetingStatus, timestamp } from '../lib/transcription'

const route = getRouteApi('/_workspace/meetings/$meetingId')

export function MeetingDetailPage() {
  const { meetingId } = route.useParams()
  const navigate = useNavigate()
  const meeting = useQuery(meetingQuery(meetingId))
  const [dialogOpen, setDialogOpen] = useState(false)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const remove = useMutation({
    mutationFn: () => api.deleteMeeting(meetingId),
    onSuccess: async () => {
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
      await navigate({ to: '/meetings', search: { q: '', offset: 0 } })
      queryClient.removeQueries({ queryKey: meetingQuery(meetingId).queryKey })
    },
  })
  function closeDialog() {
    if (remove.isPending) return
    setDialogOpen(false)
  }
  if (meeting.isPending) return <div className="page"><LoadingState /></div>
  if (meeting.isError) return <div className="page"><ErrorState
    title={meeting.error instanceof ApiError && meeting.error.status === 404 ? 'Встреча не найдена' : 'Не удалось открыть встречу'}
    description={errorMessage(meeting.error)} onRetry={() => void meeting.refetch()}>
    <Button variant="default" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}>К встречам</Button>
  </ErrorState></div>
  return <div className="page">
    <Anchor className="page-back" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}><ArrowLeft size={19} aria-hidden="true" />К встречам</Anchor>
    <header className="page-header">
      <PageHeading title={meeting.data.title}><Badge color="gray" variant="light" radius="xl" tt="none">{meetingStatus(meeting.data)}</Badge></PageHeading>
      <Button ref={deleteTrigger} variant="light" color="red" leftSection={<Trash2 size={18} aria-hidden="true" />} onClick={() => setDialogOpen(true)}>Удалить встречу</Button>
      <Modal.Root opened={dialogOpen} onClose={closeDialog} centered size={460} closeOnClickOutside={false} closeOnEscape={!remove.isPending}
        returnFocus onExitTransitionEnd={() => { if (!remove.isSuccess) deleteTrigger.current?.focus() }}>
        <Modal.Overlay />
        <Modal.Content className="delete-dialog">
          <Modal.Header><Modal.Title>Удалить встречу?</Modal.Title></Modal.Header>
          <Modal.Body>
            <Text>Встреча «{meeting.data.title}», её аудиозапись и стенограмма будут удалены. Это действие нельзя отменить.</Text>
            {remove.isError && <InlineError>{errorMessage(remove.error, 'Не удалось удалить встречу. Попробуйте ещё раз.')}</InlineError>}
            <div className="dialog-actions">
              <Button variant="default" data-autofocus disabled={remove.isPending} onClick={closeDialog}>Отмена</Button>
              <Button color="red.8" loading={remove.isPending} aria-busy={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Удаляем…' : 'Удалить'}</Button>
            </div>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </header>
    <article className="transcript-panel" aria-labelledby="transcript-title">
      <header className="section-header"><Title order={2} size="h3" id="transcript-title">Стенограмма</Title></header>
      <Transcription meeting={meeting.data} />
      <div className="transcript-text" data-testid="transcript">{meeting.data.transcript}</div>
      {!!meeting.data.segments?.length && <Disclosure label="Временные отметки" className="transcript-segments">
        <ol>{meeting.data.segments.map((segment, index) => <li key={index}>
          <time>{timestamp(segment.start)}</time><p>{segment.text}</p>
        </li>)}</ol>
      </Disclosure>}
      <Alert color="gray" icon={<Info size={22} aria-hidden="true" />} className="analysis-panel">Генерация протокола пока недоступна</Alert>
    </article>
    {meeting.data.transcript.trim() && <MeetingChat key={meetingId} meetingId={meetingId} />}
  </div>
}
