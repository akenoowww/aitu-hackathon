import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, Navigate, Outlet } from '@tanstack/react-router'
import { WorkspaceShell } from './components/shell'
import { ErrorState } from './components/ui'
import { meetingSearchSchema } from './lib/contracts'
import { Button } from '@mantine/core'

const rootRoute = createRootRoute({
  component: Outlet,
  errorComponent: ({ reset }) => <main className="main-content"><ErrorState description="Не удалось открыть страницу. Попробуйте ещё раз." onRetry={reset} /></main>,
  notFoundComponent: () => <main className="main-content"><ErrorState title="Страница не найдена" description="Вернитесь к списку встреч."><Button renderRoot={(props) => <Link {...props} to="/meetings" search={{ q: '', offset: 0 }} />}>К встречам</Button></ErrorState></main>,
})
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Navigate to="/meetings" search={{ q: '', offset: 0 }} replace /> })
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: lazyRouteComponent(() => import('./routes/login'), 'LoginPage') })
const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, id: '_workspace', component: WorkspaceShell })
const meetingsRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/meetings', validateSearch: (search) => meetingSearchSchema.parse(search), component: lazyRouteComponent(() => import('./routes/meetings'), 'MeetingsPage') })
const newMeetingRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/meetings/new', component: lazyRouteComponent(() => import('./routes/new-meeting'), 'NewMeetingPage') })
const meetingRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/meetings/$meetingId', component: lazyRouteComponent(() => import('./routes/meeting-detail'), 'MeetingDetailPage') })
const routeTree = rootRoute.addChildren([indexRoute, loginRoute, workspaceRoute.addChildren([meetingsRoute, newMeetingRoute, meetingRoute])])
export const router = createRouter({ routeTree, scrollRestoration: true })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
