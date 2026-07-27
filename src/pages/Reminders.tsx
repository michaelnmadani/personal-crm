import { useState } from 'react'
import { subMonths } from 'date-fns'
import { useDoneReminders, useOpenReminders } from '../lib/hooks'
import { ago, daysUntil, effectiveDue, isDueNow } from '../lib/utils'
import { Icon } from '../components/Icon'
import { ReminderForm } from '../components/ReminderForm'
import { ReminderItem } from '../components/ReminderItem'
import { btnPrimary, card } from '../components/ui'

export function Reminders() {
  const { data: open } = useOpenReminders()
  const { data: done } = useDoneReminders()
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showArchive, setShowArchive] = useState(false)

  const reminders = open ?? []
  // "Done" stays a short list of what you've just cleared; anything completed
  // more than a month ago moves to the archive so it stops piling up. A missing
  // completion date can't be shown as recent, so it archives too.
  const monthAgo = subMonths(new Date(), 1)
  const isRecent = (r: { completed_at: string | null }) => !!r.completed_at && new Date(r.completed_at) >= monthAgo
  const recentlyDone = (done ?? []).filter(isRecent)
  const archived = (done ?? []).filter((r) => !isRecent(r))
  const overdue = reminders.filter(isDueNow)
  const week = reminders.filter((r) => !isDueNow(r) && daysUntil(effectiveDue(r)) <= 7)
  const later = reminders.filter((r) => !isDueNow(r) && daysUntil(effectiveDue(r)) > 7)

  const completedList = (
    title: string,
    items: typeof reminders,
    open_: boolean,
    toggle: () => void,
    hint: string,
  ) =>
    items.length > 0 && (
      <section className={`${card} p-4`}>
        <button className="text-sm font-semibold text-slate-400 hover:text-slate-200" onClick={toggle}>
          {title} ({items.length}) {open_ ? '▾' : '▸'}
        </button>
        {open_ && (
          <>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
            <ul className="mt-2 space-y-1.5">
              {items.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm text-slate-400">
                  <Icon name="check" className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="line-through">{r.title}</span>
                  {r.completed_at && <span className="text-xs text-slate-500 ml-auto shrink-0">{ago(r.completed_at)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    )

  const group = (title: string, items: typeof reminders, tone = 'text-slate-300') =>
    items.length > 0 && (
      <section className={`${card} p-4`}>
        <h2 className={`text-sm font-semibold mb-1 ${tone}`}>{title}</h2>
        <div className="divide-y divide-slate-800">
          {items.map((r) => (
            <ReminderItem key={r.id} reminder={r} />
          ))}
        </div>
      </section>
    )

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <button className={btnPrimary} onClick={() => setAdding(true)}>
          <Icon name="plus" className="w-4 h-4" /> New
        </button>
      </header>

      {reminders.length === 0 && (
        <div className={`${card} p-8 text-center text-slate-500 text-sm`}>No open reminders. Enjoy the quiet.</div>
      )}

      {group(`Needs attention (${overdue.length})`, overdue, 'text-red-400')}
      {group('Next 7 days', week)}
      {group('Later', later)}

      {completedList('Done', recentlyDone, showDone, () => setShowDone(!showDone), 'completed in the last month')}
      {completedList('Archive', archived, showArchive, () => setShowArchive(!showArchive), 'completed over a month ago')}

      {adding && <ReminderForm onClose={() => setAdding(false)} />}
    </div>
  )
}
