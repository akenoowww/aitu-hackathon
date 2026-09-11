import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, LogOut } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { queryClient, sessionQuery } from '../lib/query'
import { Brand, ErrorState, LoadingState } from './ui'

export function WorkspaceShell() {
  const session = useQuery(sessionQuery)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { queryClient.clear(); queryClient.setQueryData(['session'], null) },
  })
  if (session.isPending) return <main className="main-content"><LoadingState /></main>
  if (session.isError) return <main className="main-content"><ErrorState description={errorMessage(session.error)} onRetry={() => void session.refetch()} /></main>
  if (!session.data) return <Navigate to="/login" replace />
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="sidebar">
      <Link to="/meetings" search={{ q: '', offset: 0 }} aria-label="Aimeet — все встречи"><Brand /></Link>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        <Link className="nav-link" activeProps={{ className: 'active' }} to="/meetings" search={{ q: '', offset: 0 }} activeOptions={{ includeSearch: false }}>
          <CalendarDays size={21} aria-hidden="true" />Встречи
        </Link>
      </nav>
      <div className="sidebar-footer">
        <div className="account" title={session.data.email}>
          <span className="account-avatar" aria-hidden="true">{(session.data.display_name || session.data.email).slice(0, 1).toUpperCase()}</span>
          <span className="account-info"><strong>{session.data.display_name || 'Рабочая учётная запись'}</strong><span>{session.data.email}</span></span>
        </div>
        {logout.isError && <p className="inline-error" role="alert">{errorMessage(logout.error, 'Не удалось выйти. Попробуйте ещё раз.')}</p>}
        <button className="signout" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut size={20} aria-hidden="true" />{logout.isPending ? 'Выходим…' : 'Выйти'}
        </button>
      </div>
    </aside>
    <main id="main-content" className="main-content" tabIndex={-1}><Outlet /></main>
  </div>
}
