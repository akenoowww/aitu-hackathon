import { useEffect, useState } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, PasswordInput, Text, TextInput, Title } from '@mantine/core'
import { ArrowRight } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import { loginSchema, type LoginInput } from '../lib/contracts'
import { queryClient, sessionQuery } from '../lib/query'
import { Brand, InlineError } from '../components/ui'
import { brand, pageTitle } from '../brand'

export function LoginPage() {
  useEffect(() => { document.title = pageTitle('Вход') }, [])
  const [passwordVisible, setPasswordVisible] = useState(false)
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
  return <div className="login-page"><main className="login-layout">
    <section className="login-story" aria-label={`О ${brand.name}`}>
      <Brand />
      <div className="login-story-copy">
        <p className="login-eyebrow">Память ваших встреч</p>
        <h2>Разговоры<br />остаются<br /><span>с вами.</span></h2>
        <p className="login-story-description">Сохраняйте записи встреч, находите нужные слова и задавайте вопросы по стенограмме.</p>
      </div>
      <div className="login-workflow" aria-label="От записи к ответам">
        <span>Аудио</span><ArrowRight size={15} aria-hidden="true" /><span>Стенограмма</span><ArrowRight size={15} aria-hidden="true" /><span>Ответы</span>
      </div>
    </section>
    <section className="login-form-panel" aria-labelledby="login-heading">
    <p className="login-eyebrow">С возвращением</p>
    <Title id="login-heading" order={1} size="h2">Войти в рабочее пространство</Title>
    <Text c="dimmed" size="sm" className="login-description">Ваши встречи и стенограммы — в одном месте.</Text>
    <form className="login-form" noValidate onSubmit={form.handleSubmit((values) => login.mutate(values))}>
      <TextInput label="Электронная почта" id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@company.kz" error={form.formState.errors.email?.message} {...form.register('email')} />
      <PasswordInput label="Пароль" id="password" autoComplete="current-password" maxLength={1024} error={form.formState.errors.password?.message}
        visible={passwordVisible} onVisibilityChange={setPasswordVisible} visibilityToggleButtonProps={{ 'aria-label': passwordVisible ? 'Скрыть пароль' : 'Показать пароль' }} {...form.register('password')} />
      {login.isError && <InlineError>{loginError}</InlineError>}
      <Button type="submit" loading={login.isPending} aria-busy={login.isPending} rightSection={<ArrowRight size={18} aria-hidden="true" />}>{login.isPending ? 'Входим…' : 'Войти'}</Button>
    </form>
    </section>
  </main></div>
}
