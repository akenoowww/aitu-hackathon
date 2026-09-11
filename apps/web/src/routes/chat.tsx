import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ActionIcon, Alert, Anchor, Button, Loader, Textarea } from '@mantine/core'
import { ArrowRight, ArrowUp, CalendarDays, MessageSquare, Plus, Search } from 'lucide-react'
import { PageHeading } from '../components/ui'
import { sessionQuery } from '../lib/query'
import { ragApi, ragError, searchWorkspace, type WorkspaceAnswer } from '../lib/rag'
import '../components/rag/workspace-chat.css'

const suggestions = [
  'На какой встрече обсуждали бюджет?',
  'Что решили по срокам запуска?',
  'Какие договорённости были с клиентом?',
]
type Turn = { question: string; result: WorkspaceAnswer }

function AnswerContent({ result }: { result: WorkspaceAnswer }) {
  const sources = new Map(result.sources.map((source) => [source.source_id, source]))
  return <div className="workspace-chat-answer">
    <div className="workspace-chat-speaker"><MessageSquare size={17} aria-hidden="true" />Soyle</div>
    {result.status === 'insufficient_evidence'
      ? <p>{result.coverage.total === 0 ? 'В вашем рабочем пространстве пока нет встреч для поиска.' : result.coverage.ready === 0 ? 'В доступных встречах пока нет стенограмм для поиска.' : 'В найденных фрагментах недостаточно данных для ответа. Уточните тему, имя или формулировку вопроса.'}</p>
      : result.claims.map((claim, i) => <div className="workspace-chat-claim" key={i}>
        <p>{claim.text}</p>
        <div className="workspace-chat-citations">
          {claim.citations.map((citation, j) => {
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
  </div>
}

export function ChatPage() {
  const cache = useQueryClient()
  const session = useQuery(sessionQuery)
  const historyKey = ['workspace-chat', session.data?.id, 'turns']
  // Keep this tab's conversation during navigation; the existing logout clears the cache.
  const history = useQuery<Turn[]>({ queryKey: historyKey, queryFn: () => [], initialData: [], enabled: false, gcTime: Infinity })
  const turns = history.data
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const activeSearch = useRef<AbortController | null>(null)
  useEffect(() => () => activeSearch.current?.abort(), [])
  const config = useQuery({ queryKey: ['rag', 'config'], queryFn: ({ signal }) => ragApi.config(signal) })
  const statusKey = ['rag', 'workspace', session.data?.id, 'index']
  const status = useQuery({
    queryKey: statusKey, queryFn: ({ signal }) => ragApi.workspaceStatus(signal),
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.pending ? 2000 : false,
  })
  const ask = useMutation({
    mutationFn: (value: string) => {
      const controller = new AbortController()
      activeSearch.current = controller
      return searchWorkspace(value, controller.signal, (data) => cache.setQueryData(statusKey, data))
    },
    onSuccess: (result, value) => {
      cache.setQueryData<Turn[]>(historyKey, (old = []) => [...old, { question: value, result }])
      setQuestion('')
      void cache.invalidateQueries({ queryKey: statusKey })
    },
    onError: () => { void status.refetch() },
  })
  useEffect(() => {
    if (turns.length || ask.isPending) bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length, ask.isPending])
  const ready = !status.isError && !config.isError && Boolean(config.data)
  const cloud = config.data && (config.data.llm_provider === 'openai' || config.data.embedding_provider === 'openai')
  function submit() {
    if (ready && question.trim() && !ask.isPending) ask.mutate(question.trim())
  }
  return <div className={`page workspace-chat ${turns.length || ask.isPending ? 'has-conversation' : ''}`}>
    <header className="page-header workspace-chat-header">
      <div><PageHeading title="Чат" /><p className="workspace-chat-subtitle">По всем встречам</p></div>
      {turns.length > 0 && <Button variant="subtle" leftSection={<Plus size={17} aria-hidden="true" />} disabled={ask.isPending} onClick={() => {
        cache.setQueryData(historyKey, []); ask.reset(); setQuestion(''); input.current?.focus()
      }}>Новый диалог</Button>}
    </header>
    {(status.isError || config.isError) && <Alert color="red" title="Поиск недоступен" role="alert">
      {ragError(status.error ?? config.error, 'workspace')}
      <Button variant="subtle" onClick={() => { void status.refetch(); void config.refetch() }}>Повторить</Button>
    </Alert>}
    {turns.length === 0 && !ask.isPending ? <section className="workspace-chat-welcome" aria-labelledby="chat-welcome">
      <h2 id="chat-welcome">О чём говорили<br className="workspace-chat-mobile-break" /> на встречах?</h2>
      <p>Найдите обсуждения, решения и договорённости — с цитатами из встреч.</p>
      <div className="workspace-chat-suggestions">{suggestions.map((value) => <button type="button" key={value} onClick={() => { setQuestion(value); ask.reset(); input.current?.focus() }}>
        <Search size={20} aria-hidden="true" /><span>{value}</span><ArrowRight size={18} aria-hidden="true" />
      </button>)}</div>
    </section> : <section className="workspace-chat-conversation" aria-label="Диалог о встречах" aria-live="polite" aria-relevant="additions">
      {turns.map((turn, i) => <article className="workspace-chat-turn" key={i}>
        <h2 className="workspace-chat-question">{turn.question}</h2><AnswerContent result={turn.result} />
      </article>)}
      {ask.isPending && <article className="workspace-chat-turn"><h2 className="workspace-chat-question">{ask.variables}</h2><div className="workspace-chat-thinking" role="status"><Loader size="sm" />Ищем по стенограммам встреч…</div></article>}
      <div ref={bottom} />
    </section>}
    <div className="workspace-chat-composer-wrap">
      {ask.isError && <Alert color="red" role="alert">{ragError(ask.error, 'workspace')} Вопрос сохранён — его можно отправить снова.</Alert>}
      <form className="workspace-chat-composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Textarea ref={input} aria-label="Вопрос по всем встречам" placeholder="Спросите о ваших встречах…" value={question} maxLength={2000} autosize minRows={1} maxRows={6} disabled={ask.isPending}
          onChange={(event) => { setQuestion(event.target.value); if (ask.isError) ask.reset() }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
        <ActionIcon type="submit" size={46} radius="xl" aria-label="Отправить вопрос" disabled={!ready || !question.trim()} loading={ask.isPending}><ArrowUp size={23} aria-hidden="true" /></ActionIcon>
      </form>
      <p className="workspace-chat-note">{status.isPending || config.isPending ? 'Проверяем доступность поиска…' : 'Поиск по существующим встречам. Каждый вопрос рассматривается отдельно.'}</p>
      {cloud && <p className="workspace-chat-note">Вопросы и фрагменты встреч передаются в OpenAI. Для поиска может передаваться вся стенограмма.</p>}
    </div>
  </div>
}
