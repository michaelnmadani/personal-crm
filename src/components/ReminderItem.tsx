import { addDays } from 'date-fns'
import { Link } from 'react-router-dom'
import type { Reminder } from '../lib/types'
import { api, useMut } from '../lib/hooks'
import { effectiveDue, fmtDateTime, fullName, isDueNow } from '../lib/utils'
import { Icon } from './Icon'

export function ReminderItem({ reminder, showContact = true }: { reminder: Reminder; showContact?: boolean }) {
  const complete = useMut(api.completeReminder)
  const snooze = useMut(api.snoozeReminder)
  const remove = useMut(api.deleteReminder)
  const due = effectiveDue(reminder)
  const overdue = isDueNow(reminder)

  return (
    <div className="flex items-start gap-3 py-2.5 group">
      <button
        onClick={() => complete.mutate(reminder)}
        className="mt-0.5 w-5 h-5 rounded-full border-2 border-slate-600 hover:border-emerald-400 hover:bg-emerald-400/20 grid place-items-center shrink-0"
        aria-label="Complete"
        title="Mark done"
      >
        <Icon name="check" className="w-3 h-3 opacity-0 group-hover:opacity-100 text-emerald-400" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-100">{reminder.title}</p>
        <p className="text-xs text-slate-500">
          <span className={overdue ? 'text-red-400 font-medium' : ''}>{fmtDateTime(due)}</span>
          {reminder.recurrence_days ? ` · repeats every ${reminder.recurrence_days}d` : ''}
          {showContact && reminder.contacts && (
            <>
              {' · '}
              <Link to={`/contacts/${reminder.contacts.id}`} className="text-indigo-400 hover:underline">
                {fullName(reminder.contacts)}
              </Link>
            </>
          )}
        </p>
        {reminder.notes && <p className="text-xs text-slate-400 mt-0.5 whitespace-pre-wrap">{reminder.notes}</p>}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={() => snooze.mutate({ id: reminder.id, until: addDays(new Date(), 1) })}
          className="px-1.5 py-0.5 text-[11px] rounded bg-slate-800 text-slate-400 hover:text-slate-200"
          title="Snooze 1 day"
        >
          +1d
        </button>
        <button
          onClick={() => snooze.mutate({ id: reminder.id, until: addDays(new Date(), 7) })}
          className="px-1.5 py-0.5 text-[11px] rounded bg-slate-800 text-slate-400 hover:text-slate-200"
          title="Snooze 1 week"
        >
          +1w
        </button>
        <button
          onClick={() => remove.mutate(reminder.id)}
          className="p-1 text-slate-500 hover:text-red-400"
          aria-label="Delete"
        >
          <Icon name="trash" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
