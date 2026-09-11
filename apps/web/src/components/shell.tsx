import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, LogOut } from 'lucide-react'
import { Anchor, Avatar, Button, NavLink } from '@mantine/core'
import { api, errorMessage } from '../lib/api'
import { queryClient, sessionQuery } from '../lib/query'
import { Brand, ErrorState, InlineError, LoadingState } from './ui'
import { brand } from '../brand'

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
    <Anchor className="skip-link" href="#main-content">К содержимому</Anchor>
    <aside className="sidebar">
      <Anchor underline="never" renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} aria-label={`${brand.name} — все встречи`} />}><Brand /></Anchor>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        <NavLink active label="Встречи" leftSection={<CalendarDays size={21} aria-hidden="true" />} className="nav-link"
          renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} activeOptions={{ includeSearch: false }} />} />
      </nav>
      <div className="sidebar-footer">
        <div className="account" title={session.data.email}>
          <Avatar size="sm" radius="xl" color="gray" aria-hidden="true">{(session.data.display_name || session.data.email).slice(0, 1).toUpperCase()}</Avatar>
          <span className="account-info"><strong>{session.data.display_name || 'Рабочая учётная запись'}</strong><span>{session.data.email}</span></span>
        </div>
        {logout.isError && <InlineError>{errorMessage(logout.error, 'Не удалось выйти. Попробуйте ещё раз.')}</InlineError>}
        <Button variant="subtle" color="gray" className="signout" justify="start" leftSection={<LogOut size={20} aria-hidden="true" />} onClick={() => logout.mutate()} loading={logout.isPending} aria-busy={logout.isPending}>
          {logout.isPending ? 'Выходим…' : 'Выйти'}
        </Button>
      </div>
    </aside>
    <main id="main-content" className="main-content" tabIndex={-1}><Outlet /></main>
  </div>
}
