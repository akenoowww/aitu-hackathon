import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Avatar, Badge, Button, Checkbox, Flex, Menu, Modal, Progress, SegmentedControl, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { Archive, CalendarDays, Download, GripVertical, Plus, Search, Sparkles } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { boardApi, boardError, cardInputSchema, emptyCard, agreements, clarificationLabels, kinds, overdue, priorities, statuses, type Card, type CardInput, type Evidence } from '../../lib/board'
import type { MeetingDetail } from '../../lib/contracts'
import { EvidenceButton, MeetingEvidence } from './meeting-evidence'
import { Disclosure } from '../ui'
import './meeting-board.css'

const options = (record: Record<string, string>) => Object.entries(record).map(([value, label]) => ({ value, label }))
const taskStatuses = ['todo', 'doing', 'blocked', 'done'] as const
const kindKeys = ['task', 'decision', 'topic', 'question', 'risk'] as const

export function MeetingBoard({ meetingId, title, canGenerate, meeting }: { meetingId: string; title: string; canGenerate: boolean; meeting: MeetingDetail }) {
  const cache = useQueryClient()
  const key = ['board', meetingId]
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => boardApi.get(meetingId, signal),
    refetchInterval: (q) => ['queued', 'running'].includes(q.state.data?.status ?? '') ? 2000 : false })
  const [view, setView] = useState('tasks')
  const [search, setSearch] = useState('')
  const [assignee, setAssignee] = useState<string | null>(null)
  const [priority, setPriority] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState(false)
  const [needsClarification, setNeedsClarification] = useState(false)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [pendingExport, setPendingExport] = useState<'csv' | 'json' | 'pdf' | null>(null)
  const [lateOnly, setLateOnly] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [editing, setEditing] = useState<{ card?: Card; version: number } | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const generation = useMutation({ mutationFn: () => boardApi.generate(meetingId), onSuccess: (data) => cache.setQueryData(key, data) })
  const save = useMutation({
    mutationFn: ({ card, changes }: { card: Card; changes: Partial<CardInput> }) => boardApi.save(
      meetingId, query.data!.version, { ...cardInputSchema.parse(card), ...changes }, card.id),
    onSuccess: (data) => cache.setQueryData(key, data),
    onError: () => { void query.refetch() },
  })
  const download = useMutation({ mutationFn: (format: 'csv' | 'json' | 'ics') => boardApi.download(meetingId, format) })
  const board = query.data
  const busy = generation.isPending || ['queued', 'running'].includes(board?.status ?? '')
  const cards = board?.cards ?? []
  const activeTasks = cards.filter((c) => c.kind === 'task' && c.status !== 'dismissed')
  const completed = activeTasks.filter((c) => c.status === 'done').length
  const unresolved = cards.filter((c) => c.status !== 'dismissed' && c.clarifications.length > 0)
  const visible = cards.filter((card) => (showArchive ? card.status === 'dismissed' : card.status !== 'dismissed')
    && (!search || [card.title, card.description, card.assignee, card.due_text].filter(Boolean).join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    && (!assignee || (assignee === '__none' ? !card.assignee : card.assignee === assignee))
    && (!priority || card.priority === priority) && (!needsReview || !card.reviewed) && (!lateOnly || overdue(card))
    && (!needsClarification || card.clarifications.length > 0))
  function move(card: Card, status: Card['status']) { if (!save.isPending && card.status !== status) save.mutate({ card, changes: { status } }) }
  const canExportCalendar = cards.some((c) => c.kind === 'task' && c.reviewed && c.agreement === 'confirmed' && c.due_date && !['done', 'dismissed'].includes(c.status))
  const hasFilters = !!(search || assignee || priority || needsReview || lateOnly || needsClarification)
  function exportNow(format: 'csv' | 'json' | 'pdf') {
    if (format === 'pdf') window.print()
    else download.mutate(format)
  }
  function requestExport(format: 'csv' | 'json' | 'pdf') {
    if (unresolved.length || cards.some((c) => !c.reviewed && c.status !== 'dismissed')) setPendingExport(format)
    else exportNow(format)
  }
  function showClarifications() {
    setView('content'); setSearch(''); setAssignee(null); setPriority(null); setLateOnly(false)
    setShowArchive(false); setNeedsReview(false); setNeedsClarification(true)
  }
  return <section className="meeting-board transcript-panel" aria-labelledby="meeting-board-title">
    <header className="board-heading">
      <div><Title order={2} id="meeting-board-title" size="h2">Итоги встречи</Title>
        <Text c="dimmed" size="sm">Поручения и договорённости из обсуждения</Text></div>
      <div className="board-actions no-print">
        <Button variant="default" leftSection={<Plus size={16} />} disabled={!board || query.isError} onClick={() => setEditing({ version: board!.version })}>Добавить карточку</Button>
        {board && board.status !== 'ready' && <Button leftSection={<Sparkles size={16} />} loading={busy}
          disabled={!canGenerate || query.isError} onClick={() => generation.mutate()}>{busy ? 'Разбираем встречу…' : board.status === 'failed' ? 'Повторить разбор' : 'Разобрать встречу'}</Button>}
      </div>
    </header>
    {query.isPending && <Text role="status">Загружаем итоги встречи…</Text>}
    {query.isError && <Alert color="red" role="alert">{boardError(query.error)} <Button variant="subtle" onClick={() => void query.refetch()}>Повторить загрузку</Button></Alert>}
    {!query.isError && board && <>
      {board.status === 'idle' && !cards.length && <div className="board-intro no-print">
        <Sparkles size={24} aria-hidden="true" /><div><Text fw={600}>Стенограмма станет рабочей доской</Text>
          <Text size="sm" c="dimmed">Разберите встречу локальной моделью или добавьте карточки вручную. Неозвученные исполнители и сроки останутся пустыми.</Text>
          {!canGenerate && <Text size="sm">Автоматический разбор станет доступен после подготовки стенограммы.</Text>}</div></div>}
      {busy && <div role="status" className="board-progress"><Text size="sm">Выделяем решения и поручения. Можно уйти со страницы — обработка продолжится.</Text><Progress value={board.progress} animated aria-label="Обработка встречи" /></div>}
      {board.status === 'failed' && <Alert color="red" role="alert">{boardError(board.error_code)}</Alert>}
      {generation.isError && <Alert color="red" role="alert">{boardError(generation.error)}</Alert>}
      {save.isError && <Alert color="red" role="alert">{boardError(save.error)}</Alert>}
      {!!activeTasks.length && <Text size="sm" c="dimmed" className="board-tally no-print">
        Завершено {completed} из {activeTasks.length} поручений
        {cards.some(overdue) && <span className="card-overdue"> · Просрочено: {cards.filter(overdue).length}</span>}
      </Text>}
      {!!unresolved.length && <div className="board-clarification-summary no-print">
        <Text size="sm">В карточках остались вопросы: {unresolved.length}</Text>
        <Button variant="subtle" size="compact-sm" onClick={showClarifications}>Перейти к уточнениям</Button>
      </div>}
      <div className="board-tools no-print">
        <SegmentedControl value={view} onChange={setView} aria-label="Представление итогов" data={[
          { value: 'tasks', label: 'Канбан поручений' }, { value: 'content', label: 'По содержанию' }, { value: 'summary', label: 'Выжимка' },
        ]} />
        <Menu position="bottom-end" withinPortal><Menu.Target>
          <Button variant="default" leftSection={<Download size={16} />} disabled={!cards.length && !board.summary.length}>Экспорт</Button>
        </Menu.Target><Menu.Dropdown>
          <Menu.Label>Вся доска, без фильтров</Menu.Label>
          <Menu.Item disabled={download.isPending} onClick={() => requestExport('csv')}>Скачать CSV</Menu.Item>
          <Menu.Item disabled={download.isPending} onClick={() => requestExport('json')}>Скачать JSON</Menu.Item>
          <Menu.Item onClick={() => requestExport('pdf')}>Печать / PDF</Menu.Item>
          <Menu.Divider /><Menu.Label>Подтверждённые поручения с датой</Menu.Label>
          <Menu.Item disabled={download.isPending || !canExportCalendar} onClick={() => download.mutate('ics')}>Календарь .ics</Menu.Item>
        </Menu.Dropdown></Menu>
      </div>
      {download.isError && <Alert color="red" role="alert">{boardError(download.error)}</Alert>}
      {view !== 'summary' && <div className="board-filters no-print">
        <TextInput aria-label="Поиск по карточкам" placeholder="Найти карточку" leftSection={<Search size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Select aria-label="Фильтр по ответственному" placeholder="Все ответственные" clearable searchable value={assignee} onChange={setAssignee}
          data={[{ value: '__none', label: 'Без ответственного' }, ...Array.from(new Set(cards.flatMap((c) => c.assignee ? [c.assignee] : []))).map((name) => ({ value: name, label: name }))]} />
        <Disclosure label="Ещё фильтры" className="board-more-filters"><div className="board-filter-options">
        <Select aria-label="Фильтр по приоритету" placeholder="Все приоритеты" clearable value={priority} onChange={setPriority} data={options(priorities)} />
        <Checkbox label="Нужно проверить" checked={needsReview} onChange={(e) => setNeedsReview(e.currentTarget.checked)} />
        <Checkbox label="Есть уточнения" checked={needsClarification} onChange={(e) => setNeedsClarification(e.currentTarget.checked)} />
        <Checkbox label="Просрочено" checked={lateOnly} onChange={(e) => setLateOnly(e.currentTarget.checked)} />
        <Checkbox label="Архив" checked={showArchive} onChange={(e) => setShowArchive(e.currentTarget.checked)} />
        </div></Disclosure>
        {hasFilters && <Button variant="subtle" size="compact-sm" onClick={() => { setSearch(''); setAssignee(null); setPriority(null); setNeedsReview(false); setLateOnly(false); setNeedsClarification(false) }}>Сбросить фильтры</Button>}
      </div>}
      {view === 'summary' ? <div className="board-summary screen-only">
        <Title order={3} size="h4">Кратко о встрече</Title>
        {!board.summary.length ? <Text c="dimmed">Выжимка появится после разбора содержательной стенограммы.</Text> : board.summary.map((sentence, i) => <div key={i}><Text>{sentence.text}</Text><Disclosure label={`Основание ${i + 1}`}><blockquote>{sentence.quote}</blockquote>{sentence.evidence && <EvidenceButton evidence={sentence.evidence} onOpen={setEvidence} />}</Disclosure></div>)}
      </div> : <>
        {view === 'tasks' && <Text size="xs" c="dimmed" className="no-print">Перетащите поручение в другую колонку или выберите статус в карточке.</Text>}
        <div className={`kanban-grid screen-only ${view === 'content' ? 'content-grid' : ''}`}>
          {(showArchive ? ['dismissed'] : view === 'tasks' ? [...taskStatuses] : [...kindKeys]).map((column) => {
            const rows = visible.filter((c) => showArchive ? (view === 'content' || c.kind === 'task') : view === 'tasks' ? c.kind === 'task' && c.status === column : c.kind === column)
            const label = showArchive ? 'Архив карточек' : view === 'tasks' ? statuses[column as Card['status']] : kinds[column as Card['kind']]
            return <section key={column} className={`kanban-column column-${column} ${dropTarget === column ? 'drop-target' : ''}`} aria-label={label}
              onDragOver={(e) => { if (view === 'tasks' && dragged) { e.preventDefault(); setDropTarget(column) } }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); setDropTarget(null); const card = cards.find((c) => c.id === dragged); if (card && view === 'tasks') move(card, column as Card['status']); setDragged(null) }}>
              <header><span className="column-dot" /><Title order={3} size="sm">{label}</Title><span className="column-count">{rows.length}</span></header>
              {!rows.length && <div className="column-empty">{hasFilters ? 'Нет совпадений' : 'Пока нет карточек'}</div>}
              {rows.map((card) => <article className="kanban-card" key={card.id} draggable={view === 'tasks' && !save.isPending}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); setDragged(card.id) }} onDragEnd={() => { setDragged(null); setDropTarget(null) }}>
                <div className="card-badges">{card.priority !== 'unspecified' && <Badge variant="light" color={card.priority === 'high' ? 'red' : 'gray'} size="sm">{priorities[card.priority]}</Badge>}
                  {['task', 'decision'].includes(card.kind) && <Badge variant="light" color={card.agreement === 'confirmed' ? 'forest' : 'orange'} c={card.agreement === 'confirmed' ? undefined : '#8a3511'} size="sm">{agreements[card.agreement]}</Badge>}
                  {view === 'tasks' && <GripVertical size={15} className="card-grip" aria-hidden="true" />}</div>
                <button className="card-title" onClick={() => { save.reset(); setEditing({ card, version: board.version }) }}>{card.title}</button>
                {card.description && <Text size="sm" c="dimmed" className="card-description">{card.description}</Text>}
                <div className="card-meta"><span className="card-person"><Avatar size={30} radius="xl" color="forest" aria-hidden="true">{card.assignee?.slice(0, 1).toLocaleUpperCase() || '?'}</Avatar>{card.assignee || 'Ответственный не указан'}</span>
                  <span className={`card-date ${overdue(card) ? 'card-overdue' : ''}`}><CalendarDays size={17} aria-hidden="true" />{card.due_date ? `${overdue(card) ? 'Просрочено: ' : 'Срок: '}${card.due_date.split('-').reverse().join('.')}` : card.due_text ? `Срок: ${card.due_text}` : 'Срок не указан'}</span></div>
                <div className="card-review"><Text size="xs" c="dimmed">{card.origin === 'ai' ? 'Черновик ИИ' : 'Добавлено вручную'}{card.reviewed ? ' · Проверено вами' : ' · Нужно проверить'}</Text></div>
                {card.quote && <Disclosure label="Цитата из встречи"><blockquote>{card.quote}</blockquote>{card.evidence && <EvidenceButton evidence={card.evidence} onOpen={setEvidence} />}</Disclosure>}
                {!!card.revisions.length && <Disclosure label={`Изменения в разговоре · ${card.revisions.length}`}><CardRevisions card={card} onOpen={setEvidence} /></Disclosure>}
                {!!card.clarifications.length && <Button variant="subtle" color="orange" c="#8a3511" size="compact-xs" onClick={() => setEditing({ card, version: board.version })}>Уточнить: {card.clarifications.length}</Button>}
                {card.kind === 'task' && <Select aria-label={`Статус: ${card.title}`} size="xs" value={card.status} data={options(statuses)} disabled={save.isPending}
                  onChange={(value) => { if (value) move(card, value as Card['status']) }} />}
                <Flex gap="xs" wrap="wrap"><Button variant="subtle" size="compact-xs" onClick={() => setEditing({ card, version: board.version })}>Открыть</Button>
                  {!card.reviewed && <Button variant="subtle" size="compact-xs" disabled={save.isPending} onClick={() => save.mutate({ card, changes: { reviewed: true } })}>Проверено</Button>}
                  {card.status !== 'dismissed' && <Button variant="subtle" color="gray" size="compact-xs" aria-label={`В архив: ${card.title}`} disabled={save.isPending} onClick={() => move(card, 'dismissed')}><Archive size={13} /></Button>}</Flex>
              </article>)}
            </section>
          })}
        </div>
      </>}
      <div className="board-print"><h1>{title}</h1><h2>Итоги встречи</h2>
        {board.summary.map((s, i) => <p key={i}>{s.text}</p>)}
        {kindKeys.map((kind) => <section key={kind}><h2>{kinds[kind]}</h2>{cards.filter((c) => c.kind === kind).map((c) => <article key={c.id}><h3>{c.title}</h3><p>{c.description}</p><p>{c.assignee || 'Ответственный не указан'} · {c.due_date || c.due_text || 'Срок не указан'} · {priorities[c.priority]} · {statuses[c.status]} · {agreements[c.agreement]} · {c.reviewed ? 'Проверено пользователем' : 'Не проверено'}</p>{c.quote && <blockquote>{c.quote}</blockquote>}
          {!!c.clarifications.length && <p>Уточнения: {c.clarifications.map((code) => clarificationLabels[code] ?? 'Проверьте карточку').join('; ')}</p>}
          {c.revisions.map((revision, i) => <div key={i}><p>{revisionLabels[revision.field]}: {revision.before_value} → {revision.after_value}</p><blockquote>{revision.before.quote}</blockquote><blockquote>{revision.after.quote}</blockquote></div>)}
        </article>)}</section>)}
      </div>
    </>}
    {editing && <CardEditor meetingId={meetingId} initial={editing.card} version={editing.version} onEvidence={setEvidence}
      onClose={() => setEditing(null)} onSaved={(data) => { cache.setQueryData(key, data); setEditing(null) }} onRefresh={() => query.refetch()} />}
    {evidence && <MeetingEvidence key={`${evidence.start_char}:${evidence.end_char}`} meeting={meeting} evidence={evidence} onClose={() => setEvidence(null)} />}
    <Modal opened={pendingExport !== null} onClose={() => setPendingExport(null)} title="Проверить перед экспортом" centered closeButtonProps={{ 'aria-label': 'Закрыть проверку экспорта' }}>
      <Text size="sm">В протоколе есть непроверенные карточки или незаполненные договорённости. Можно уточнить их сейчас или сохранить документ с текущими пометками.</Text>
      <Flex mt="lg" gap="sm" wrap="wrap"><Button variant="default" onClick={() => { setPendingExport(null); showClarifications(); if (!unresolved.length) { setNeedsClarification(false); setNeedsReview(true) } }}>Уточнить карточки</Button>
        <Button onClick={() => { const format = pendingExport; setPendingExport(null); if (format) setTimeout(() => exportNow(format), 250) }}>Экспортировать с пометками</Button></Flex>
    </Modal>
  </section>
}

const revisionLabels = { due_text: 'Срок', assignee: 'Ответственный', decision: 'Решение' }
function CardRevisions({ card, onOpen }: { card: Card; onOpen: (evidence: Evidence) => void }) {
  return <ol className="card-revisions">{card.revisions.map((revision, i) => <li key={i}>
    <Text size="sm" fw={600}>{revisionLabels[revision.field]}: {revision.before_value} → {revision.after_value}</Text>
    <blockquote>{revision.before.quote}</blockquote><EvidenceButton label="До изменения" evidence={revision.before} onOpen={onOpen} />
    <blockquote>{revision.after.quote}</blockquote><EvidenceButton label="После изменения" evidence={revision.after} onOpen={onOpen} />
  </li>)}</ol>
}

function CardEditor({ meetingId, initial, version, onClose, onSaved, onRefresh, onEvidence }: {
  meetingId: string; initial?: Card; version: number; onClose: () => void
  onSaved: (board: Awaited<ReturnType<typeof boardApi.get>>) => void
  onRefresh: () => Promise<unknown>
  onEvidence: (evidence: Evidence) => void
}) {
  const form = useForm<CardInput>({ resolver: zodResolver(cardInputSchema), defaultValues: initial ? cardInputSchema.parse(initial) : emptyCard })
  const mutation = useMutation({ mutationFn: (values: CardInput) => boardApi.save(meetingId, version, values, initial?.id), onSuccess: onSaved })
  const conflict = mutation.error instanceof ApiError && mutation.error.kind === 'BOARD_CONFLICT'
  const select = (name: 'kind' | 'priority' | 'status' | 'agreement', label: string, values: Record<string, string>) => <Controller name={name} control={form.control} render={({ field }) => <Select label={label} data={options(values)} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={form.formState.errors[name]?.message} />} />
  return <Modal opened onClose={() => { if (!mutation.isPending) onClose() }} title={initial ? 'Карточка встречи' : 'Новая карточка'} size="lg" centered closeOnClickOutside={false} closeOnEscape={!mutation.isPending} withCloseButton={!mutation.isPending} closeButtonProps={{ 'aria-label': 'Закрыть карточку' }}>
    <form className="card-editor" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      {!!initial?.clarifications.length && <Alert color="orange" className="card-clarifications-alert" title="Что нужно уточнить"><ul className="card-clarifications">{initial.clarifications.map((code) => <li key={code}>{clarificationLabels[code] ?? 'Проверьте карточку'}</li>)}</ul></Alert>}
      {initial?.evidence && <EvidenceButton evidence={initial.evidence} onOpen={onEvidence} />}
      <TextInput label="Суть карточки" required maxLength={500} data-autofocus {...form.register('title')} error={form.formState.errors.title?.message} />
      <Textarea label="Детали" rows={3} maxLength={4000} {...form.register('description')} />
      <div className="editor-grid">{select('kind', 'Тип карточки', kinds)}{select('priority', 'Приоритет', priorities)}</div>
      <Controller name="assignee" control={form.control} render={({ field }) => <TextInput label="Ответственный" placeholder="Не указан" maxLength={200} value={field.value ?? ''} onChange={(e) => field.onChange(e.currentTarget.value || null)} />} />
      <div className="editor-grid"><Controller name="due_date" control={form.control} render={({ field }) => <TextInput label="Дата выполнения" type="date" value={field.value ?? ''} onChange={(e) => field.onChange(e.currentTarget.value || null)} error={form.formState.errors.due_date?.message} />} />
        <Controller name="due_text" control={form.control} render={({ field }) => <TextInput label="Срок как озвучен" placeholder="Например: к пятнице" maxLength={200} value={field.value ?? ''} onChange={(e) => field.onChange(e.currentTarget.value || null)} />} /></div>
      <div className="editor-grid">{select('status', 'Статус', statuses)}{select('agreement', 'Договорённость', agreements)}</div>
      <Controller name="quote" control={form.control} render={({ field }) => <Textarea label="Цитата из стенограммы" description="Необязательно для ручной карточки. Скопируйте исходный фрагмент без изменений." rows={3} maxLength={2000} value={field.value ?? ''} onChange={(e) => { field.onChange(e.currentTarget.value || null); form.setValue('quote_start', null) }} />} />
      <Controller name="reviewed" control={form.control} render={({ field }) => <Checkbox label="Я проверил содержание, ответственного и срок" checked={field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} />} />
      {!!initial?.revisions.length && <Disclosure label="Изменения в разговоре"><CardRevisions card={initial} onOpen={onEvidence} /></Disclosure>}
      {mutation.isError && <Alert color="red" role="alert">{boardError(mutation.error)}{conflict && <Button variant="subtle" onClick={() => { void onRefresh(); onClose() }}>Закрыть и обновить доску</Button>}</Alert>}
      <Flex justify="flex-end" gap="sm"><Button variant="default" disabled={mutation.isPending} onClick={onClose}>Отмена</Button><Button type="submit" loading={mutation.isPending} disabled={conflict}>Сохранить карточку</Button></Flex>
    </form>
  </Modal>
}
