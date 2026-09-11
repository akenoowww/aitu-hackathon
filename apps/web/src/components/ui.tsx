import { useEffect, useRef, type ReactNode } from 'react'
import { AudioLines, CircleAlert, FileText } from 'lucide-react'

export function Brand() {
  return <span className="brand"><AudioLines className="brand-mark" size={30} aria-hidden="true" /><span className="brand-name">Aimeet</span></span>
}

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    document.title = `${title} · Aimeet`
    heading.current?.focus({ preventScroll: true })
  }, [title])
  return <div className="page-heading"><h1 ref={heading} tabIndex={-1}>{title}</h1>{children}</div>
}

export function LoadingState() {
  return <div className="page-loading" role="status" aria-label="Загрузка">
    <span className="sr-only">Загружаем рабочее пространство…</span>
    <div className="skeleton skeleton-heading" />
    <div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" />
  </div>
}

export function ErrorState({ title = 'Не удалось загрузить данные', description, onRetry, children }: {
  title?: string; description: string; onRetry?: () => void; children?: ReactNode;
}) {
  return <section className="error-state" role="alert">
    <CircleAlert className="error-icon" size={30} aria-hidden="true" />
    <div className="error-copy"><h2>{title}</h2><p>{description}</p></div>
    {onRetry && <button className="button button-secondary" onClick={onRetry}>Попробовать снова</button>}
    {children}
  </section>
}

export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className="empty-state">
    <div className="empty-icon"><FileText size={30} strokeWidth={1.5} aria-hidden="true" /></div>
    <h2 className="empty-title">{title}</h2><p className="empty-description">{description}</p>{children}
  </section>
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return <div id={id} className="field-error" aria-live="polite">{message}</div>
}
