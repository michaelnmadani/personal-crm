import { useState } from 'react'
import { addDays, addMonths, format } from 'date-fns'
import type { InteractionKind } from '../lib/types'
import { api, useContacts, useMut } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { btnPrimary, input, label } from './ui'

const KINDS: InteractionKind[] = ['meeting', 'call', 'email', 'message', 'event', 'note']

/**
 * How far out a follow-up can be set while writing the entry. Chosen up front
 * because that is when you know you owe one — by the time the note is saved the
 * thought has usually gone.
 */
const FOLLOW_UPS = [
  { label: '1 day', due: () => addDays(new Date(), 1) },
  { label: '2 days', due: () => addDays(new Date(), 2) },
  { label: '7 days', due: () => addDays(new Date(), 7) },
  { label: '1 month', due: () => addMonths(new Date(), 1) },
]

/** Follow-ups land at 9am, not at whatever minute the note was written. */
const dueAt = (choice: (typeof FOLLOW_UPS)[number]) => {
  const d = choice.due()
  d.setHours(9, 0, 0, 0)
  return d
}

/** Inline "log an interaction" box used on the contact profile. */
export function InteractionComposer({ contactId, contactName }: { contactId: string; contactName?: string }) {
  const { data: contacts } = useContacts()
  const log = useMut(api.logInteraction)
  const addReminder = useMut(api.addReminder)
  const [kind, setKind] = useState<InteractionKind>('meeting')
  const [when, setWhen] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [remember, setRemember] = useState('')
  const [others, setOthers] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [offerFollowUp, setOfferFollowUp] = useState(false)
  // Chosen before saving; the reminder is written once the entry it belongs to
  // exists, so the two can be shown together.
  const [followUp, setFollowUp] = useState<(typeof FOLLOW_UPS)[number] | null>(null)
  // The entry just logged, so a follow-up added from the nudge below still
  // attaches to it.
  const [lastLogged, setLastLogged] = useState<string | null>(null)

  const otherOptions = (contacts ?? []).filter((c) => c.id !== contactId)

  const remind = (due: Date, interactionId: string | null) =>
    addReminder.mutateAsync({
      title: `Follow up with ${contactName ?? 'them'}`,
      due_at: due.toISOString(),
      contact_id: contactId,
      notes: null,
      recurrence_days: null,
      interaction_id: interactionId,
    })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!notes.trim() && !title.trim()) return
    const loggedKind = kind
    const chosen = followUp
    let logged
    try {
      logged = await log.mutateAsync({
        kind,
        happened_at: new Date(when).toISOString(),
        title: title.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        remember: remember.trim() || null,
        participantIds: [contactId, ...others],
      })
      if (chosen) await remind(dueAt(chosen), logged.id)
    } catch {
      return
    }
    setTitle('')
    setLocation('')
    setNotes('')
    setRemember('')
    setOthers([])
    setExpanded(false)
    setFollowUp(null)
    setLastLogged(logged.id)
    // Research-backed nudge: following up within 24–48h of a meeting roughly
    // doubles response rates vs. waiting 72h+. No need to ask if they already said.
    if (!chosen && (loggedKind === 'meeting' || loggedKind === 'call' || loggedKind === 'event')) setOfferFollowUp(true)
  }

  const scheduleFollowUp = async (days: number) => {
    const due = addDays(new Date(), days)
    due.setHours(9, 0, 0, 0)
    try {
      await remind(due, lastLogged)
    } catch {
      return
    }
    setOfferFollowUp(false)
  }

  return (
    <div className="space-y-2">
      {offerFollowUp && (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-3 text-sm">
          <p className="text-slate-200">
            Logged. <span className="text-slate-400">Set a follow-up? Replies drop ~50% once you're past 48 hours.</span>
          </p>
          <div className="flex gap-2 mt-2">
            <button className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs" onClick={() => scheduleFollowUp(1)}>
              Tomorrow
            </button>
            <button className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs" onClick={() => scheduleFollowUp(2)}>
              In 2 days
            </button>
            <button className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs" onClick={() => scheduleFollowUp(7)}>
              Next week
            </button>
            <button className="px-2 py-1 text-slate-500 hover:text-slate-300 text-xs ml-auto" onClick={() => setOfferFollowUp(false)}>
              No thanks
            </button>
          </div>
          {addReminder.isError && <p className="mt-2 text-sm text-red-400">{(addReminder.error as Error).message}</p>}
        </div>
      )}
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500">Follow up in</span>
          {FOLLOW_UPS.map((f) => {
            const on = followUp?.label === f.label
            return (
              <button
                key={f.label}
                type="button"
                aria-pressed={on}
                className={`px-2 py-0.5 rounded-full border text-xs ${
                  on
                    ? 'border-indigo-400 bg-indigo-500/20 text-slate-100'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
                onClick={() => setFollowUp(on ? null : f)}
              >
                {f.label}
              </button>
            )
          })}
          {followUp && (
            <span className="text-xs text-slate-500">· reminder for {format(dueAt(followUp), 'EEE d MMM')}</span>
          )}
        </div>
        <textarea
          className={input}
          rows={expanded ? 4 : 2}
          placeholder="What happened? Notes from your meeting, call, or anything worth remembering…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onFocus={() => setExpanded(true)}
        />
        {expanded && (
          <>
            <div>
              <span className={label}>Remember — items to carry forward</span>
              <textarea
                className={input}
                rows={2}
                placeholder="Key takeaways, promises made, things to remember (spouse's name, next steps)…"
                value={remember}
                onChange={(e) => setRemember(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className={label}>Type</span>
                <select className={input} value={kind} onChange={(e) => setKind(e.target.value as InteractionKind)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={label}>When (backfill past meetings freely)</span>
                <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div>
                <span className={label}>Title</span>
                <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee catch-up" />
              </div>
              <div>
                <span className={label}>Location</span>
                <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Balzac's" />
              </div>
            </div>
            {otherOptions.length > 0 && (
              <div>
                <span className={label}>Also with</span>
                <select
                  multiple
                  className={`${input} h-20`}
                  value={others}
                  onChange={(e) => setOthers(Array.from(e.target.selectedOptions, (o) => o.value))}
                >
                  {otherOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {fullName(c)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end">
          <button type="submit" className={btnPrimary} disabled={log.isPending || (!notes.trim() && !title.trim())}>
            {log.isPending ? 'Saving…' : 'Log it'}
          </button>
        </div>
        {(log.isError || addReminder.isError) && (
          <p className="text-sm text-red-400">{((log.error ?? addReminder.error) as Error).message}</p>
        )}
      </form>
    </div>
  )
}
