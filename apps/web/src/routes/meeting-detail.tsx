import { useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { ArrowLeft, Info, Trash2 } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import { meetingQuery, queryClient } from '../lib/query'
import { ErrorState, LoadingState, PageHeading } from '../components/ui'

const route = getRouteApi('/_workspace/meetings/$meetingId')

export function MeetingDetailPage() {
  const { meetingId } = route.useParams()
  const navigate = useNavigate()
  const meeting = useQuery(meetingQuery(meetingId))
  const [dialogOpen, setDialogOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.deleteMeeting(meetingId),
    onSuccess: async () => {
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['meetings', 'list'] })
      await navigate({ to: '/meetings', search: { q: '', offset: 0 } })
      queryClient.removeQueries({ queryKey: meetingQuery(meetingId).queryKey })
    },
  })
  if (meeting.isPending) return <div className="page"><LoadingState /></div>
  if (meeting.isError) return <div className="page"><ErrorState
    title={meeting.error instanceof ApiError && meeting.error.status === 404 ? 'Встреча не найдена' : 'Не удалось открыть встречу'}
    description={errorMessage(meeting.error)} onRetry={() => void meeting.refetch()}>
    <Link className="button button-secondary" to="/meetings" search={{ q: '', offset: 0 }}>К встречам</Link>
  </ErrorState></div>
  return <div className="page">
    <Link className="page-back" to="/meetings" search={{ q: '', offset: 0 }}><ArrowLeft size={19} aria-hidden="true" />К встречам</Link>
    <header className="page-header">
      <PageHeading title={meeting.data.title}><span className="badge">Черновик</span></PageHeading>
      <AlertDialog.Root open={dialogOpen} onOpenChange={(open) => { if (!remove.isPending) setDialogOpen(open) }}>
        <AlertDialog.Trigger asChild><button className="button button-danger"><Trash2 size={18} aria-hidden="true" />Удалить встречу</button></AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog-content" onEscapeKeyDown={(event) => { if (remove.isPending) event.preventDefault() }}>
            <AlertDialog.Title className="dialog-title">Удалить встречу?</AlertDialog.Title>
            <AlertDialog.Description className="dialog-description">Встреча «{meeting.data.title}» и её стенограмма будут удалены. Это действие нельзя отменить.</AlertDialog.Description>
            {remove.isError && <p className="inline-error" role="alert">{errorMessage(remove.error, 'Не удалось удалить встречу. Попробуйте ещё раз.')}</p>}
            <div className="dialog-actions">
              <AlertDialog.Cancel className="button button-secondary" disabled={remove.isPending}>Отмена</AlertDialog.Cancel>
              <AlertDialog.Action className="button button-danger" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate() }}>{remove.isPending ? 'Удаляем…' : 'Удалить'}</AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </header>
    <article className="transcript-panel" aria-labelledby="transcript-title">
      <header className="section-header"><h2 id="transcript-title">Стенограмма</h2></header>
      <div className="transcript-text" data-testid="transcript">{meeting.data.transcript}</div>
      <aside className="analysis-panel"><Info className="analysis-icon" size={22} aria-hidden="true" /><p className="analysis-description">Генерация протокола пока недоступна</p></aside>
    </article>
  </div>
}
