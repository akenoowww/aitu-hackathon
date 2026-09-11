import { MutationCache, QueryCache, QueryClient, queryOptions } from '@tanstack/react-query'
import { api, ApiError } from './api'

function handleUnauthorized(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return
  queryClient.removeQueries({ queryKey: ['meetings'] })
  queryClient.setQueryData(['session'], null)
}
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
})
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: ({ signal }) => api.session(signal), retry: false })
export const meetingsQuery = (q: string, offset: number) => queryOptions({
  queryKey: ['meetings', 'list', { q, offset }], queryFn: ({ signal }) => api.meetings(q, offset, signal),
})
export const meetingQuery = (id: string) => queryOptions({
  queryKey: ['meetings', 'detail', id], queryFn: ({ signal }) => api.meeting(id, signal),
})
