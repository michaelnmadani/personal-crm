import { useState } from 'react'
import { format } from 'date-fns'
import type { InteractionKind } from '../lib/types'
import { api, useContacts, useMut } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { btnPrimary, input, label } from './ui'

const KINDS: InteractionKind[] = ['meeting', 'call', 'email', 'message', 'event', 'note']

/** Inline "log an interaction" box used on the contact profile. */
export function InteractionComposer({ contactId }: { contactId: string }) {
  const { data: contacts } = useContacts()
  const log = useMut(api.logInteraction)
  const [kind, setKind] = useState<InteractionKind>('meeting')
  const [when, setWhen] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [others, setOthers] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  const otherOptions = (contacts ?? []).filter((c) => c.id !== contactId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!notes.trim() && !title.trim()) return
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
  }

  return (
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
              <span className={label}>When</span>
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
  )
}
