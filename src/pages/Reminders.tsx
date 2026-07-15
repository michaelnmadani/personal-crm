import { useState } from 'react'
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

  const reminders = open ?? []
  const overdue = reminders.filter(isDueNow)
  const week = reminders.filter((r) => !isDueNow(r) && daysUntil(effectiveDue(r)) <= 7)
  const later = reminders.filter((r) => !isDueNow(r) && daysUntil(effectiveDue(r)) > 7)

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

      {(done ?? []).length > 0 && (
        <section className={`${card} p-4`}>
          <button className="text-sm font-semibold text-slate-500 hover:text-slate-300" onClick={() => setShowDone(!showDone)}>
            Done ({done!.length}) {showDone ? '▾' : '▸'}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1.5">
              {done!.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm text-slate-500">
                  <Icon name="check" className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="line-through">{r.title}</span>
                  {r.completed_at && <span className="text-xs text-slate-600 ml-auto">{ago(r.completed_at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {adding && <ReminderForm onClose={() => setAdding(false)} />}
    </div>
  )
}
