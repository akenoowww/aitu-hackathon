import { useEffect } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError, errorMessage } from '../lib/api'
import { loginSchema, type LoginInput } from '../lib/contracts'
import { queryClient, sessionQuery } from '../lib/query'
import { Brand, FieldError } from '../components/ui'

export function LoginPage() {
  useEffect(() => { document.title = 'Вход · Aimeet' }, [])
  const session = useQuery(sessionQuery)
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (user) => { queryClient.clear(); queryClient.setQueryData(['session'], user) },
  })
  if (session.data) return <Navigate to="/meetings" search={{ q: '', offset: 0 }} replace />
  const loginError = login.error instanceof ApiError && login.error.status === 401
    ? 'Проверьте электронную почту и пароль.'
    : errorMessage(login.error, 'Не удалось войти. Проверьте соединение и попробуйте ещё раз.')
  return <div className="login-page"><main className="login-form-panel">
    <Brand />
    <h1 className="login-title">Войти в рабочее пространство</h1>
    <form className="login-form" noValidate onSubmit={form.handleSubmit((values) => login.mutate(values))}>
      <div className="field">
        <label className="field-label" htmlFor="email">Электронная почта</label>
        <input className="input" id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@company.kz" aria-invalid={!!form.formState.errors.email} aria-describedby="email-error" {...form.register('email')} />
        <FieldError id="email-error" message={form.formState.errors.email?.message} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="password">Пароль</label>
        <input className="input" id="password" type="password" autoComplete="current-password" maxLength={1024} aria-invalid={!!form.formState.errors.password} aria-describedby="password-error" {...form.register('password')} />
        <FieldError id="password-error" message={form.formState.errors.password?.message} />
      </div>
      {login.isError && <p className="inline-error" role="alert">{loginError}</p>}
      <button className="button button-primary" type="submit" disabled={login.isPending} aria-busy={login.isPending}>{login.isPending ? 'Входим…' : 'Войти'}</button>
    </form>
  </main></div>
}
