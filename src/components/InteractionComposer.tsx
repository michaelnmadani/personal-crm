import { useState } from 'react'
import { addDays, format } from 'date-fns'
import type { InteractionKind } from '../lib/types'
import { api, useContacts, useMut } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { btnPrimary, input, label } from './ui'

const KINDS: InteractionKind[] = ['meeting', 'call', 'email', 'message', 'event', 'note']

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
  const [others, setOthers] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [offerFollowUp, setOfferFollowUp] = useState(false)

  const otherOptions = (contacts ?? []).filter((c) => c.id !== contactId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!notes.trim() && !title.trim()) return
    const loggedKind = kind
    await log.mutateAsync({
      kind,
      happened_at: new Date(when).toISOString(),
      title: title.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      participantIds: [contactId, ...others],
    })
    setTitle('')
    setLocation('')
    setNotes('')
    setOthers([])
    setExpanded(false)
    // Research-backed nudge: following up within 24–48h of a meeting roughly
    // doubles response rates vs. waiting 72h+.
    if (loggedKind === 'meeting' || loggedKind === 'call' || loggedKind === 'event') setOfferFollowUp(true)
  }

  const scheduleFollowUp = async (days: number) => {
    const due = addDays(new Date(), days)
    due.setHours(9, 0, 0, 0)
    await addReminder.mutateAsync({
      title: `Follow up with ${contactName ?? 'them'}`,
      due_at: due.toISOString(),
      contact_id: contactId,
      notes: null,
      recurrence_days: null,
    })
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
        </div>
      )}
      <form onSubmit={submit} className="space-y-2">
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
        {log.isError && <p className="text-sm text-red-400">{(log.error as Error).message}</p>}
      </form>
    </div>
  )
}
