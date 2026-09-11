import { useState, type FormEvent } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, Plus, Search, X } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { meetingsQuery } from '../lib/query'
import { EmptyState, ErrorState, LoadingState, PageHeading } from '../components/ui'

const route = getRouteApi('/_workspace/meetings')

function SearchForm({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [text, setText] = useState(value)
  function submit(event: FormEvent) { event.preventDefault(); onSearch(text.trim()) }
  return <form className="search-form" role="search" onSubmit={submit}>
    <label className="field-label" htmlFor="meeting-search">Поиск по названию</label>
    <div className="search-input-wrap">
      <Search size={20} aria-hidden="true" />
      <input className="search-input" id="meeting-search" type="search" placeholder="Введите название встречи" value={text} maxLength={200} onChange={(event) => setText(event.target.value)} />
      {text && <button className="clear-search button-icon" type="button" aria-label="Сбросить поиск" onClick={() => { setText(''); onSearch('') }}><X size={18} aria-hidden="true" /></button>}
      <button className="button button-secondary button-small" type="submit">Найти</button>
    </div>
  </form>
}

export function MeetingsPage() {
  const { q, offset } = route.useSearch()
  const navigate = useNavigate()
  const meetings = useQuery(meetingsQuery(q, offset))
  const changeSearch = (value: string) => { void navigate({ to: '/meetings', search: { q: value, offset: 0 } }) }
  const changePage = (value: number) => { void navigate({ to: '/meetings', search: { q, offset: value } }) }
  return <div className="page">
    <header className="page-header">
      <PageHeading title="Встречи" />
      <Link className="button button-primary" to="/meetings/new"><Plus size={20} aria-hidden="true" />Добавить встречу</Link>
    </header>
    <div className="library-toolbar"><SearchForm key={q} value={q} onSearch={changeSearch} /></div>
    {meetings.isPending ? <LoadingState /> : meetings.isError ? <ErrorState description={errorMessage(meetings.error)} onRetry={() => void meetings.refetch()} /> : meetings.data.items.length === 0 ? (
      q ? <EmptyState title="Ничего не найдено" description="Попробуйте другое название или сбросьте поиск.">
        <button className="button button-secondary" onClick={() => changeSearch('')}>Сбросить поиск</button>
      </EmptyState> : offset > 0 ? <EmptyState title="На этой странице нет встреч" description="Вернитесь к началу списка.">
        <button className="button button-secondary" onClick={() => changePage(0)}>К первой странице</button>
      </EmptyState> : <EmptyState title="Здесь будут ваши встречи" description="Добавьте первую встречу и сохраните её стенограмму в рабочем пространстве.">
        <Link className="button button-primary" to="/meetings/new"><Plus size={18} aria-hidden="true" />Добавить встречу</Link>
      </EmptyState>
    ) : <>
      <div className="meeting-list" aria-label="Список встреч">
        {meetings.data.items.map((meeting) => <Link key={meeting.id} className="meeting-row" data-testid="meeting-row" aria-label={meeting.title} to="/meetings/$meetingId" params={{ meetingId: meeting.id }}>
          <span className="meeting-file-icon"><FileText size={25} strokeWidth={1.6} aria-hidden="true" /></span>
          <span className="meeting-main"><span className="meeting-title">{meeting.title}</span><span className="meeting-meta"><span className="badge">Черновик</span></span></span>
          <ChevronRight className="meeting-arrow" size={21} aria-hidden="true" />
        </Link>)}
      </div>
      <nav className="pagination" aria-label="Страницы встреч">
        <button className="button button-secondary" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - 20))}><ChevronLeft size={18} aria-hidden="true" />Назад</button>
        <span className="result-count" aria-live="polite">{offset + 1}–{offset + meetings.data.items.length} из {meetings.data.total}</span>
        <button className="button button-secondary" disabled={offset + 20 >= meetings.data.total || offset + 20 > 100_000} onClick={() => changePage(offset + 20)}>Далее<ChevronRight size={18} aria-hidden="true" /></button>
      </nav>
    </>}
  </div>
}
