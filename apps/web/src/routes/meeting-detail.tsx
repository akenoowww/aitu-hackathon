import { useRef, useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Anchor, Badge, Button, Group, Modal, Text, Title } from '@mantine/core'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import { meetingQuery, queryClient } from '../lib/query'
import { ErrorState, InlineError, LoadingState } from '../components/ui'
import { MeetingWorkspace, type MeetingView } from '../components/audio-workspace'
import { meetingStatus } from '../lib/transcription'

const route = getRouteApi('/_workspace/meetings/$meetingId')

export function MeetingDetailPage() {
  const { meetingId } = route.useParams()
  const { view = 'conversation' } = route.useSearch()
  const navigate = useNavigate()
  const meeting = useQuery(meetingQuery(meetingId))
  const [dialogOpen, setDialogOpen] = useState(false)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const cancel = useMutation({
    mutationFn: () => api.cancelTranscription(meetingId),
    onSuccess: async (result) => {
      queryClient.setQueryData(meetingQuery(meetingId).queryKey, result)
      await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
    },
  })
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
  return <div className="saved-meeting-shell">
    <Anchor className="page-back" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}><ArrowLeft size={19} aria-hidden="true" />К встречам</Anchor>
    <header className="live-room-heading saved-meeting-header">
      <div><Title order={1}>{meeting.data.title}</Title><Text className="live-status" c="dimmed"><span className="live-status-dot" />{meeting.data.source_type === 'audio' ? 'Запись встречи' : 'Сохранённая встреча'}<Badge color="gray" variant="light" radius="xl" tt="none">{meetingStatus(meeting.data)}</Badge></Text></div>
      <Group gap="sm" className="saved-meeting-actions">
        {['queued', 'running'].includes(meeting.data.transcription?.status ?? '') && <Button variant="default" color="gray" loading={cancel.isPending} onClick={() => cancel.mutate()}>Отменить распознавание</Button>}
        <Button ref={deleteTrigger} variant="light" color="red" leftSection={<Trash2 size={18} aria-hidden="true" />} onClick={() => setDialogOpen(true)}>Удалить встречу</Button>
      </Group>
      <Modal.Root opened={dialogOpen} onClose={closeDialog} centered size={460} closeOnClickOutside={false} closeOnEscape={!remove.isPending}
        returnFocus onExitTransitionEnd={() => { if (!remove.isSuccess) deleteTrigger.current?.focus() }}>
        <Modal.Overlay />
        <Modal.Content className="delete-dialog">
          <Modal.Header><Modal.Title>Удалить встречу?</Modal.Title></Modal.Header>
          <Modal.Body>
            <Text>Встреча «{meeting.data.title}», её аудиозапись, стенограмма, итоги и карточки будут удалены. Это действие нельзя отменить.</Text>
            {remove.isError && <InlineError>{errorMessage(remove.error, 'Не удалось удалить встречу. Попробуйте ещё раз.')}</InlineError>}
            <div className="dialog-actions">
              <Button variant="default" data-autofocus disabled={remove.isPending} onClick={closeDialog}>Отмена</Button>
              <Button color="red.8" loading={remove.isPending} aria-busy={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Удаляем…' : 'Удалить'}</Button>
            </div>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </header>
    {cancel.isError && <InlineError>{errorMessage(cancel.error, 'Не удалось отменить распознавание. Попробуйте ещё раз.')}</InlineError>}
    <MeetingWorkspace key={meetingId} meeting={meeting.data} view={view}
      onViewChange={(next: MeetingView) => { void navigate({ to: '/meetings/$meetingId', params: { meetingId }, search: { view: next }, replace: true }) }} />
  </div>
}
