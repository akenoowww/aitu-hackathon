import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ActionIcon, Alert, Anchor, Button, Loader, Textarea } from '@mantine/core'
import { ArrowRight, ArrowUp, CalendarDays, CheckCircle2, ListTodo, MessageSquare, Plus, Search } from 'lucide-react'
import { PageHeading, LoadingState } from '../components/ui'
import { conversationsApi, type ConversationDetail, type ConversationSummary } from '../lib/conversations'
import { sessionQuery } from '../lib/query'
import { ragApi, ragError, talkToAssistant, type AssistantResult, type ConversationMessage } from '../lib/rag'
import '../components/rag/workspace-chat.css'

const suggestions = [
  'На какой встрече обсуждали бюджет?',
  'Как загрузить запись?',
  'Помоги составить повестку встречи',
]

function AnswerContent({ result }: { result: AssistantResult }) {
  if (result.mode === 'assistant') return <div className="workspace-chat-answer">
    <div className="workspace-chat-speaker"><MessageSquare size={17} aria-hidden="true" />Soyle</div>
    <p className="workspace-assistant-text">{result.answer}</p>
  </div>
  if (result.mode === 'tasks') return <div className="workspace-chat-answer">
    <div className="workspace-chat-speaker"><MessageSquare size={17} aria-hidden="true" />Soyle</div>
    <div className="workspace-chat-operation is-complete"><CheckCircle2 size={20} aria-hidden="true" /><strong>{result.answer}</strong></div>
    <div className="workspace-chat-created-tasks">{result.tasks.map((task) => <Link key={task.card_id} className="workspace-chat-created-task" to="/meetings/$meetingId" params={{ meetingId: task.meeting_id }} search={{ view: 'kanban' }}>
      <ListTodo size={19} aria-hidden="true" /><div><strong>{task.title}</strong><span>{task.meeting_title} · К выполнению</span>
        {task.assignee && <span>Ответственный: {task.assignee}</span>}
        {(task.due_date || task.due_text) && <span>Срок: {task.due_date || task.due_text}</span>}
      </div><ArrowRight size={17} aria-hidden="true" />
    </Link>)}</div>
  </div>
  const sources = new Map(result.sources.map((source) => [source.source_id, source]))
  return <div className="workspace-chat-answer">
    <div className="workspace-chat-speaker"><MessageSquare size={17} aria-hidden="true" />Soyle</div>
    {result.status === 'insufficient_evidence'
      ? <p>{result.coverage.total === 0 ? 'В вашем рабочем пространстве пока нет встреч для поиска.' : result.coverage.ready === 0 ? 'В доступных встречах пока нет стенограмм для поиска.' : 'В найденных фрагментах недостаточно данных для ответа. Уточните тему, имя или формулировку вопроса.'}</p>
      : result.claims.map((claim, i) => <div className="workspace-chat-claim" key={i}>
        <p>{claim.text}</p>
        <div className="workspace-chat-citations">
          {claim.citations.map((citation, j) => {
            if ('kind' in citation && citation.kind === 'board') {
              const record = result.board_sources.find((item) => item.source_id === citation.source_id)
              return record && <details className="workspace-chat-source" key={`${citation.source_id}-${j}`}>
                <summary><CalendarDays size={16} aria-hidden="true" /><span>{record.kind === 'kanban' ? 'Канбан' : 'Итоги'} · {record.meeting_title}</span><span className="workspace-chat-source-hint">Источник</span></summary>
                <blockquote>{citation.quote}</blockquote>
                {record.provisional && <p className="workspace-chat-note">Промежуточные итоги — ещё могут измениться.</p>}
                <Anchor renderRoot={(props) => <Link {...props} to="/meetings/$meetingId" params={{ meetingId: record.meeting_id }} search={{ view: record.kind === 'kanban' ? 'kanban' : 'insights' }} />}>{record.kind === 'kanban' ? 'Открыть канбан' : 'Открыть итоги'} <ArrowRight size={14} aria-hidden="true" /></Anchor>
              </details>
            }
            if ('kind' in citation && citation.kind === 'catalog') {
              const record = result.catalog_sources.find((item) => item.source_id === citation.source_id)
              return record && <details className="workspace-chat-source" key={`${citation.source_id}-${j}`}>
                <summary><CalendarDays size={16} aria-hidden="true" /><span>{record.meeting_title || 'Список встреч'}</span><span className="workspace-chat-source-hint">Источник</span></summary>
                <blockquote>{citation.quote}</blockquote>
                {record.meeting_id ? <Anchor renderRoot={(props) => <Link {...props} to="/meetings/$meetingId" params={{ meetingId: record.meeting_id! }} />}>Открыть встречу <ArrowRight size={14} aria-hidden="true" /></Anchor>
                  : <Anchor renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}>Все встречи <ArrowRight size={14} aria-hidden="true" /></Anchor>}
              </details>
            }
            const source = sources.get(citation.source_id)
            return source && <details className="workspace-chat-source" key={`${citation.source_id}-${j}`}>
              <summary><CalendarDays size={16} aria-hidden="true" /><span>{source.meeting_title}</span><span className="workspace-chat-source-hint">Цитата</span></summary>
              <blockquote>{citation.quote}</blockquote>
              <Anchor renderRoot={(props) => <Link {...props} to="/meetings/$meetingId" params={{ meetingId: source.meeting_id }} />}>Открыть встречу <ArrowRight size={14} aria-hidden="true" /></Anchor>
            </details>
          })}
        </div>
      </div>)}
    {result.coverage.ready < result.coverage.total && <p className="workspace-chat-note">Поиск выполнен по доступным стенограммам: {result.coverage.ready} из {result.coverage.total}.</p>}
    {result.board_coverage.selected_sources < result.board_coverage.available_sources && <p className="workspace-chat-note">Для ответа использована часть карточек и итогов. Уточните встречу или тему, чтобы сузить поиск.</p>}
  </div>
}

export function ChatPage() {
  const cache = useQueryClient()
  const session = useQuery(sessionQuery)
  const listKey = ['assistant-chats', session.data?.id, 'list']
  const chats = useQuery({ queryKey: listKey, queryFn: ({ signal }) => conversationsApi.list(signal) })
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const initialRequested = useRef(false)
  const create = useMutation({
    mutationFn: conversationsApi.create,
    onSuccess: (chat) => {
      cache.setQueryData<ConversationSummary[]>(listKey, (old = []) => [chat, ...old.filter((item) => item.id !== chat.id)])
      setSelected(chat.id)
    },
  })
  const createChat = create.mutate
  useEffect(() => {
    if (chats.data?.length === 0 && !initialRequested.current) {
      initialRequested.current = true
      createChat(crypto.randomUUID())
    }
  }, [chats.data, createChat])
  const active = chats.data?.find((chat) => chat.id === selected) ?? chats.data?.[0]
  if (chats.isPending) return <LoadingState />
  if (chats.isError) return <Alert color="red" title="Не удалось загрузить чаты"><Button onClick={() => void chats.refetch()}>Повторить</Button></Alert>
  return <div className="workspace-chats">
    <aside className="assistant-conversations" aria-label="Ваши чаты">
      <Button leftSection={<Plus size={17} />} variant="light" disabled={busy} loading={create.isPending} onClick={() => create.mutate(crypto.randomUUID())}>Новый чат</Button>
      {create.isError && <Alert color="red">Не удалось создать чат. Попробуйте ещё раз.</Alert>}
      <nav aria-label="Список чатов">{chats.data.map((chat) => <button type="button" key={chat.id} className={active?.id === chat.id ? 'is-active' : ''} aria-current={active?.id === chat.id ? 'page' : undefined} title={chat.title} disabled={busy} onClick={() => setSelected(chat.id)}><MessageSquare size={16} aria-hidden="true" /><span>{chat.title}</span></button>)}</nav>
    </aside>
    {active ? <ConversationPanel key={active.id} conversationId={active.id} title={active.title} onBusy={setBusy} /> : <LoadingState />}
  </div>
}

function ConversationPanel({ conversationId, title, onBusy }: { conversationId: string; title: string; onBusy: (value: boolean) => void }) {

  const cache = useQueryClient()
  const session = useQuery(sessionQuery)
  const historyKey = ['assistant-chats', session.data?.id, conversationId]
  const history = useQuery({ queryKey: historyKey, queryFn: ({ signal }) => conversationsApi.get(conversationId, signal) })
  const turns = history.data?.turns ?? []
  const [question, setQuestion] = useState('')
  const [activity, setActivity] = useState<'thinking' | 'creating'>('thinking')
  const taskOperation = useRef<{ value: string; id: string; started: boolean } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const activeSearch = useRef<AbortController | null>(null)
  useEffect(() => () => activeSearch.current?.abort(), [])
  const config = useQuery({ queryKey: ['rag', 'config'], queryFn: ({ signal }) => ragApi.config(signal) })
  const ask = useMutation({
    mutationFn: async (value: string) => {
      setActivity('thinking')
      if (!taskOperation.current || taskOperation.current.value !== value) {
        taskOperation.current = { value, id: crypto.randomUUID(), started: false }
      }
      const operation = taskOperation.current
      const controller = new AbortController()
      activeSearch.current = controller
      const context: ConversationMessage[] = turns.slice(-10).flatMap((turn) => [
        { role: 'user' as const, content: turn.question.slice(0, 6000) },
        { role: 'assistant' as const, content: (turn.result.mode === 'tasks' ? turn.result.answer + '\n' + turn.result.tasks.map((task) => `${task.title}; встреча ${task.meeting_title}; meeting_id=${task.meeting_id}`).join('\n') : turn.result.answer || 'В источниках не удалось найти подтверждение.').slice(0, 6000) },
      ])
      while (context.reduce((sum, message) => sum + message.content.length, 0) > 40_000) context.splice(0, 2)
      const result = await talkToAssistant(value, context, controller.signal, {
        id: operation.id, retryTask: operation.started,
        onTaskStart: () => { operation.started = true; setActivity('creating') },
      })
      return conversationsApi.saveTurn(conversationId, { id: operation.id, question: value, result }, controller.signal)
    },
    onSuccess: (turn) => {
      const result = turn.result
      cache.setQueryData<ConversationDetail>(historyKey, (old) => old ? { ...old, turns: old.turns.some((item) => item.id === turn.id) ? old.turns : [...old.turns, turn] } : old)
      void cache.invalidateQueries({ queryKey: ['assistant-chats', session.data?.id, 'list'] })
      setQuestion('')
      taskOperation.current = null
      if (result.mode === 'tasks') for (const task of result.tasks) void cache.invalidateQueries({ queryKey: ['board', task.meeting_id] })
    },
  })
  useEffect(() => { onBusy(ask.isPending); return () => onBusy(false) }, [ask.isPending, onBusy])
  useEffect(() => {
    if (turns.length || ask.isPending) bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length, ask.isPending])
  const ready = !config.isError && Boolean(config.data) && !history.isPending && !history.isError
  function submit() {
    if (ready && question.trim() && !ask.isPending) ask.mutate(question.trim())
  }
  return <div className={`page workspace-chat ${turns.length || ask.isPending ? 'has-conversation' : ''}`}>
    <header className="page-header workspace-chat-header">
      <div><PageHeading title="Чат" /><p className="workspace-chat-subtitle">{title === 'Новый чат' ? 'Ваш ассистент' : title}</p></div>
    </header>
    {history.isError && <Alert color="red" title="Не удалось загрузить диалог"><Button onClick={() => void history.refetch()}>Повторить</Button></Alert>}
    {config.isError && <Alert color="red" title="Ассистент недоступен" role="alert">
      {ragError(config.error, 'workspace')}
      <Button variant="subtle" onClick={() => { void config.refetch() }}>Повторить</Button>
    </Alert>}
    {turns.length === 0 && !ask.isPending ? <section className="workspace-chat-welcome" aria-labelledby="chat-welcome">
      <h2 id="chat-welcome">Чем могу помочь?</h2>
      <p>Помогу разобраться в Soyle, обсудить идею или найти нужное в ваших встречах.</p>
      <div className="workspace-chat-suggestions">{suggestions.map((value) => <button type="button" key={value} onClick={() => { setQuestion(value); ask.reset(); input.current?.focus() }}>
        <Search size={20} aria-hidden="true" /><span>{value}</span><ArrowRight size={18} aria-hidden="true" />
      </button>)}</div>
    </section> : <section className="workspace-chat-conversation" aria-label="Диалог с ассистентом" aria-live="polite" aria-relevant="additions">
      {turns.map((turn, i) => <article className="workspace-chat-turn" key={i}>
        <h2 className="workspace-chat-question">{turn.question}</h2><AnswerContent result={turn.result} />
      </article>)}
      {ask.isPending && <article className="workspace-chat-turn"><h2 className="workspace-chat-question">{ask.variables}</h2><div className={activity === 'creating' ? 'workspace-chat-operation' : 'workspace-chat-thinking'} role="status"><Loader size="sm" />{activity === 'creating' ? <div><strong>Создаю задачи в канбане…</strong><p>Проверяю встречу и добавляю карточки.</p></div> : 'Готовлю ответ…'}</div></article>}
      <div ref={bottom} />
    </section>}
    <div className="workspace-chat-composer-wrap">
      {ask.isError && <Alert color="red" role="alert">{ragError(ask.error, 'workspace')} Вопрос сохранён — его можно отправить снова.</Alert>}
      <form className="workspace-chat-composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Textarea ref={input} aria-label="Сообщение ассистенту" placeholder="Напишите сообщение…" value={question} maxLength={2000} autosize minRows={1} maxRows={6} disabled={ask.isPending}
          onChange={(event) => { setQuestion(event.target.value); if (ask.isError) ask.reset() }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
        <ActionIcon type="submit" size={46} radius="xl" aria-label="Отправить вопрос" disabled={!ready || !question.trim()} loading={ask.isPending}><ArrowUp size={23} aria-hidden="true" /></ActionIcon>
      </form>
      <p className="workspace-chat-note">{config.isPending || history.isPending ? 'Подключаем ассистента…' : 'Общение, помощь с Soyle и поиск по встречам.'}</p>
    </div>
  </div>
}
