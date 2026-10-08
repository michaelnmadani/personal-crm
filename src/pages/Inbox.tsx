import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import type { ContactOverview, InteractionKind } from '../lib/types'
import type { CaptureDraft } from '../lib/types'
import {
  api,
  useCaptureAliases,
  useCaptureDrafts,
  useContacts,
  useMut,
  useResolvedCaptures,
} from '../lib/hooks'
import {
  aliasFor,
  buildNameIndex,
  normalizeName,
  parseCapture,
  segmentsOf,
  type Mention,
  type ParsedCapture,
  type WhenSource,
} from '../lib/parseCapture'
import { fullName } from '../lib/utils'
import { Icon, KIND_ICON } from '../components/Icon'
import { btnGhost, btnPrimary, card, chip, input } from '../components/ui'

type Kind = InteractionKind | 'reminder'

const KINDS: { value: Kind; label: string }[] = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'message', label: 'Message' },
  { value: 'event', label: 'Event' },
  { value: 'note', label: 'Note' },
  { value: 'reminder', label: 'Task' },
]

const toInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")
const fromInput = (s: string) => (s ? new Date(s) : null)

/** One person on a draft, and which heard name (if any) they were picked for. */
type Pick = { contactId: string; mention: number | null }

type FollowUpDraft = { title: string; due: string; contactId: string | null; include: boolean }

/**
 * Captures waiting to be confirmed. Each is read when it's shown, against the
 * moment it was said, and every guess is laid out to be checked — who, when,
 * and what — with anything the reading wasn't sure of called out, so checking
 * is a glance when it's right and obvious when it isn't.
 */
export function Inbox() {
  const { data: drafts, isLoading, error } = useCaptureDrafts()
  const { data: contacts } = useContacts()
  const { data: aliases } = useCaptureAliases()
  const { data: resolved } = useResolvedCaptures()
  const [done, setDone] = useState<{ text: string; to: string } | null>(null)

  const index = useMemo(() => buildNameIndex(contacts ?? [], aliases ?? []), [contacts, aliases])
  const byId = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, c])), [contacts])
  const ready = !!contacts && !!aliases
  // Read each draft once per contact list, not on every render.
  const parsedById = useMemo(
    () => new Map((drafts ?? []).map((d) => [d.id, parseCapture(d.raw_text, new Date(d.captured_at), index)])),
    [drafts, index],
  )

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <Link to="/capture" className={btnPrimary}>
          <Icon name="mic" className="w-4 h-4" /> Capture
        </Link>
      </header>

      {done && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          <Icon name="check" className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="flex-1 text-slate-200">{done.text}</span>
          <Link to={done.to} className="text-indigo-400 hover:underline shrink-0">
            Open
          </Link>
          <button onClick={() => setDone(null)} className="text-slate-500 hover:text-slate-300" aria-label="Dismiss">
            <Icon name="x" className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error ? (
        <p className={`${card} p-4 text-sm text-red-400`}>Couldn’t load captures: {(error as Error).message}</p>
      ) : isLoading || !ready ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (drafts ?? []).length === 0 ? (
        <div className={`${card} p-8 text-center space-y-3`}>
          <p className="text-sm text-slate-400">Nothing to review.</p>
          <p className="text-xs text-slate-500">Things you capture land here to be checked before they’re saved.</p>
          <Link to="/capture" className="inline-block text-sm text-indigo-400 hover:underline">
            Capture something →
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {(drafts ?? []).map((d) => (
            <li key={d.id}>
              <TriageCard
                draft={d}
                parsed={parsedById.get(d.id)!}
                contacts={contacts ?? []}
                byId={byId}
                onDone={setDone}
              />
            </li>
          ))}
        </ul>
      )}

      <Handled drafts={resolved ?? []} />
    </div>
  )
}

function TriageCard({
  draft,
  parsed,
  contacts,
  byId,
  onDone,
}: {
  draft: CaptureDraft
  parsed: ParsedCapture
  contacts: ContactOverview[]
  byId: Map<string, ContactOverview>
  onDone: (d: { text: string; to: string }) => void
}) {
  const [kind, setKind] = useState<Kind>(parsed.kind)
  const [picks, setPicks] = useState<Pick[]>(() =>
    parsed.mentions
      .map((m, i) => ({ contactId: m.candidates[0].contactId, mention: i }))
      .filter((p, i, all) => all.findIndex((q) => q.contactId === p.contactId) === i),
  )
  const [when, setWhen] = useState(() => toInput(parsed.when))
  const [title, setTitle] = useState(parsed.title ?? '')
  const [notes, setNotes] = useState(parsed.notes ?? '')
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>(() =>
    parsed.followUps.map((f) => ({ title: f.title, due: toInput(f.due), contactId: f.contactId, include: true })),
  )
  // Once the main item exists, a retry after a failed follow-up must not make
  // it again.
  const created = useRef<{ interactionId?: string; reminderId?: string }>({})

  const isReminder = kind === 'reminder'
  const whenDate = fromInput(when)
  const said = new Date(draft.captured_at)

  // Who still needs a look: any heard name the reading wasn't sure of, or
  // nobody picked at all for something that has to belong to someone.
  const unsureMentions = parsed.mentions
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => m.confidence !== 'high' && picks.some((p) => p.mention === i))
  const whoNeedsLook = unsureMentions.length > 0 || (!isReminder && picks.length === 0)
  const whenNeedsLook = parsed.whenSource === 'assumed' || !parsed.kindConfident

  const timing =
    whenDate && isReminder && whenDate.getTime() < Date.now() - 60_000
      ? 'This is in the past — a reminder for it would be due straight away.'
      : whenDate && !isReminder && whenDate.getTime() > Date.now() + 3_600_000
        ? 'This is in the future — if it hasn’t happened yet, it may be better as a task.'
        : null

  const confirm = useMut(async () => {
    if (!whenDate || Number.isNaN(whenDate.getTime())) throw new Error('Pick a date and time.')
    const people = picks.map((p) => p.contactId)
    let to = '/reminders'
    let summary: string

    if (isReminder) {
      if (!title.trim()) throw new Error('Give the task a title.')
      if (!created.current.reminderId) {
        const r = await api.addReminder({
          title: title.trim(),
          due_at: whenDate.toISOString(),
          contact_id: people[0] ?? null,
          notes: notes.trim() || null,
          recurrence_days: null,
        })
        created.current.reminderId = r.id
      }
      const who = people[0] ? byId.get(people[0]) : undefined
      summary = `Task added${who ? ` for ${fullName(who)}` : ''} · ${format(whenDate, 'EEE d MMM, h:mm a')}`
    } else {
      if (people.length === 0) throw new Error('Pick who this was with — a timeline entry belongs to someone.')
      if (!created.current.interactionId) {
        const i = await api.logInteraction({
          kind: kind as InteractionKind,
          happened_at: whenDate.toISOString(),
          title: title.trim() || null,
          location: null,
          notes: notes.trim() || null,
          participantIds: people,
        })
        created.current.interactionId = i.id
      }
      const first = byId.get(people[0])
      to = `/contacts/${people[0]}`
      summary = `Added to ${first ? fullName(first) : 'their'}’s timeline${people.length > 1 ? ` and ${people.length - 1} more` : ''}`
    }

    for (const f of followUps) {
      if (!f.include || !f.title.trim()) continue
      const due = fromInput(f.due)
      if (!due) continue
      await api.addReminder({
        title: f.title.trim(),
        due_at: due.toISOString(),
        contact_id: f.contactId ?? people[0] ?? null,
        notes: null,
        recurrence_days: null,
        interaction_id: created.current.interactionId ?? null,
      })
    }
    // Stop re-adding them if this ever runs again.
    setFollowUps((fs) => fs.map((f) => ({ ...f, include: false })))

    await api.resolveCaptureDraft({
      id: draft.id,
      status: 'confirmed',
      interaction_id: created.current.interactionId ?? null,
      reminder_id: created.current.reminderId ?? null,
    })

    // Teach the matcher: anything it wasn't sure of, or got wrong, is now known.
    for (const p of picks) {
      if (p.mention === null) continue
      const m = parsed.mentions[p.mention]
      if (!m) continue
      if (m.confidence === 'high' && m.candidates[0].contactId === p.contactId) continue
      const heard = aliasFor(m.heard)
      if (heard) await api.rememberCaptureAlias({ heard, contact_id: p.contactId }).catch(() => undefined)
    }
    onDone({ text: summary, to })
  })

  const discard = useMut(() => api.resolveCaptureDraft({ id: draft.id, status: 'discarded' }))

  const swap = (mention: number, contactId: string) =>
    setPicks((ps) => {
      const without = ps.filter((p) => p.contactId !== contactId)
      const at = without.findIndex((p) => p.mention === mention)
      if (at === -1) return [...without, { contactId, mention }]
      return without.map((p, k) => (k === at ? { contactId, mention } : p))
    })

  const add = (contactId: string) =>
    setPicks((ps) => {
      if (ps.some((p) => p.contactId === contactId)) return ps
      // If exactly one heard name lost its pick, this is the person it meant.
      const orphaned = parsed.mentions.map((_, i) => i).filter((i) => !ps.some((p) => p.mention === i))
      return [...ps, { contactId, mention: orphaned.length === 1 ? orphaned[0] : null }]
    })

  return (
    <article className={`${card} p-4 space-y-4`}>
      {/* What was said, with what it was read as marked in place. */}
      <div>
        <p className="text-base leading-relaxed text-slate-100">
          {segmentsOf(draft.raw_text, parsed.mentions, parsed.dateSpans).map((s, i) =>
            s.mark === 'name' ? (
              <mark key={i} className="bg-indigo-500/25 text-indigo-100 rounded px-0.5">
                {s.text}
              </mark>
            ) : s.mark === 'date' ? (
              <mark key={i} className="bg-amber-500/20 text-amber-100 rounded px-0.5">
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Said {format(said, 'EEE d MMM, h:mm a')}
          {draft.source === 'shared' ? ' · shared in' : draft.source === 'speech' ? ' · talk button' : ''}
        </p>
      </div>

      {/* WHO */}
      <section className={`rounded-lg border p-3 space-y-2 ${whoNeedsLook ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800'}`}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          Who
          {whoNeedsLook && <span className="normal-case tracking-normal font-medium text-amber-400">check this</span>}
        </h3>
        {picks.length === 0 ? (
          <p className="text-sm text-slate-500">{isReminder ? 'Nobody — that’s fine for a task.' : 'Nobody picked yet.'}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {picks.map((p) => {
              const c = byId.get(p.contactId)
              const m = p.mention !== null ? parsed.mentions[p.mention] : null
              return (
                <span
                  key={p.contactId}
                  className={`${chip} py-1.5 pl-3 pr-2 text-sm ${
                    m && m.confidence !== 'high' ? 'bg-amber-500/15 text-amber-100' : 'bg-indigo-600/20 text-indigo-100'
                  }`}
                >
                  {c ? fullName(c) : 'Unknown contact'}
                  {m && m.heard.toLowerCase() !== (c ? fullName(c).toLowerCase() : '') && (
                    <span className="text-xs text-slate-400">heard “{m.heard}”</span>
                  )}
                  <button
                    onClick={() => setPicks((ps) => ps.filter((q) => q.contactId !== p.contactId))}
                    className="ml-1 p-0.5 text-slate-400 hover:text-red-400"
                    aria-label={`Remove ${c ? fullName(c) : 'contact'}`}
                  >
                    <Icon name="x" className="w-3.5 h-3.5" />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {parsed.mentions.map((m, i) => (
          <Alternatives key={i} mention={m} picks={picks} byId={byId} onPick={(id) => swap(i, id)} />
        ))}
        <ContactSearch contacts={contacts} exclude={picks.map((p) => p.contactId)} onPick={add} />
      </section>

      {/* WHEN */}
      <section className={`rounded-lg border p-3 space-y-2 ${whenNeedsLook ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800'}`}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          When
          {whenNeedsLook && <span className="normal-case tracking-normal font-medium text-amber-400">check this</span>}
        </h3>
        <input
          type="datetime-local"
          className={`${input} text-base`}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="When"
        />
        <p className="text-xs text-slate-500">{whenNote(parsed.whenSource, draft.raw_text, parsed)}</p>
        {timing && <p className="text-xs text-amber-400">{timing}</p>}
      </section>

      {/* WHAT */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          What
          {!parsed.kindConfident && (
            <span className="normal-case tracking-normal font-medium text-amber-400">couldn’t tell — check the type</span>
          )}
        </h3>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
          {KINDS.map((k) => (
            <button
              key={k.value}
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => {
                // A task needs a title; a timeline note doesn't. Carry the
                // words across rather than leave the new one blank.
                if (k.value === 'reminder' && !title.trim()) setTitle(firstLine(notes))
                setKind(k.value)
              }}
              className={`${chip} py-1.5 px-3 text-sm gap-1.5 ${
                kind === k.value ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon name={k.value === 'reminder' ? 'bell' : KIND_ICON[k.value]} className="w-3.5 h-3.5" />
              {k.label}
            </button>
          ))}
        </div>
        <input
          className={`${input} text-base`}
          placeholder={isReminder ? 'What to do' : 'Title (optional)'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
        />
        <textarea
          className={`${input} text-base`}
          rows={3}
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
        />
      </section>

      {/* Things to do said in the same breath. */}
      {followUps.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Also add {isReminder ? 'tasks' : 'follow-ups'}</h3>
          {followUps.map((f, i) => (
            <div key={i} className="rounded-lg border border-slate-800 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-indigo-500"
                  checked={f.include}
                  onChange={(e) => setFollowUps((fs) => fs.map((x, k) => (k === i ? { ...x, include: e.target.checked } : x)))}
                />
                Add this {isReminder ? 'task' : 'follow-up'}
              </label>
              <input
                className={`${input} text-base`}
                value={f.title}
                onChange={(e) => setFollowUps((fs) => fs.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
                aria-label="Follow-up title"
                disabled={!f.include}
              />
              <input
                type="datetime-local"
                className={`${input} text-base`}
                value={f.due}
                onChange={(e) => setFollowUps((fs) => fs.map((x, k) => (k === i ? { ...x, due: e.target.value } : x)))}
                aria-label="Follow-up due"
                disabled={!f.include}
              />
            </div>
          ))}
        </section>
      )}

      {(confirm.isError || discard.isError) && (
        <p className="text-sm text-red-400">{((confirm.error ?? discard.error) as Error).message}</p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button className={`${btnGhost} text-slate-400`} onClick={() => discard.mutate(undefined)} disabled={discard.isPending || confirm.isPending}>
          <Icon name="trash" className="w-4 h-4" /> Discard
        </button>
        <button
          className={`${btnPrimary} px-5 py-2.5 text-base`}
          onClick={() => confirm.mutate(undefined)}
          disabled={confirm.isPending || discard.isPending}
        >
          <Icon name="check" className="w-5 h-5" />
          {confirm.isPending ? 'Saving…' : isReminder ? 'Add task' : 'Add to timeline'}
        </button>
      </div>
    </article>
  )
}

/** "Did you mean" for one heard name: the other people it could have been. */
function Alternatives({
  mention,
  picks,
  byId,
  onPick,
}: {
  mention: Mention
  picks: Pick[]
  byId: Map<string, ContactOverview>
  onPick: (contactId: string) => void
}) {
  const taken = new Set(picks.map((p) => p.contactId))
  const others = mention.candidates.filter((c) => !taken.has(c.contactId)).slice(0, 4)
  if (others.length === 0) return null
  // With its guess removed, these are suggestions rather than alternatives.
  const stillPicked = mention.candidates.some((c) => taken.has(c.contactId))
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-xs text-slate-500">
        “{mention.heard}” {stillPicked ? 'could also be' : 'might be'}
      </span>
      {others.map((c) => {
        const person = byId.get(c.contactId)
        if (!person) return null
        return (
          <button
            key={c.contactId}
            onClick={() => onPick(c.contactId)}
            className={`${chip} py-1 px-2.5 bg-slate-800 text-slate-300 hover:bg-slate-700`}
          >
            {fullName(person)}
          </button>
        )
      })}
    </div>
  )
}

/** Find anyone by typing part of their name. */
function ContactSearch({
  contacts,
  exclude,
  onPick,
}: {
  contacts: ContactOverview[]
  exclude: string[]
  onPick: (contactId: string) => void
}) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = normalizeName(q)
    if (s.length < 2) return []
    const skip = new Set(exclude)
    const scored: { c: ContactOverview; rank: number }[] = []
    for (const c of contacts) {
      if (skip.has(c.id)) continue
      const name = normalizeName(fullName(c))
      const nick = normalizeName(c.nickname ?? '')
      const at = name.indexOf(s)
      if (at === 0 || nick.startsWith(s)) scored.push({ c, rank: 0 })
      else if (name.includes(` ${s}`)) scored.push({ c, rank: 1 })
      else if (at > 0) scored.push({ c, rank: 2 })
    }
    return scored.sort((a, b) => a.rank - b.rank || fullName(a.c).localeCompare(fullName(b.c))).slice(0, 6)
  }, [q, contacts, exclude])

  return (
    <div className="relative">
      <div className="relative">
        <Icon name="search" className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
        <input
          className={`${input} pl-9 text-base`}
          placeholder="Someone else? Type a name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a contact"
        />
      </div>
      {matches.length > 0 && (
        <ul className="mt-1 rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
          {matches.map(({ c }) => (
            <li key={c.id}>
              <button
                className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  onPick(c.id)
                  setQ('')
                }}
              >
                {fullName(c)}
                {c.company && <span className="text-slate-500"> · {c.company}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Recently confirmed or discarded, so a mistaken discard can be brought back. */
function Handled({ drafts }: { drafts: CaptureDraft[] }) {
  const restore = useMut((id: string) => api.resolveCaptureDraft({ id, status: 'pending' }))
  if (drafts.length === 0) return null
  return (
    <details className={`${card} p-4`}>
      <summary className="text-sm text-slate-400 cursor-pointer select-none">Recently handled ({drafts.length})</summary>
      <ul className="mt-3 divide-y divide-slate-800">
        {drafts.map((d) => (
          <li key={d.id} className="py-2 flex items-start gap-3">
            <span
              className={`${chip} shrink-0 mt-0.5 ${
                d.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {d.status}
            </span>
            <p className="flex-1 text-sm text-slate-400 line-clamp-2">{d.raw_text}</p>
            {d.status === 'discarded' && (
              <button
                className="text-xs text-indigo-400 hover:underline shrink-0"
                onClick={() => restore.mutate(d.id)}
                disabled={restore.isPending}
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      {restore.isError && <p className="text-sm text-red-400 mt-2">{(restore.error as Error).message}</p>}
    </details>
  )
}

function firstLine(s: string) {
  const line = s.split(/[\n.!?]/)[0]?.trim() ?? ''
  return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line
}

/** Say where the date came from, so a filled-in one is never mistaken for a heard one. */
function whenNote(source: WhenSource, raw: string, parsed: ParsedCapture): string {
  const heard = parsed.dateSpans[0] ? `“${raw.slice(parsed.dateSpans[0].start, parsed.dateSpans[0].end)}”` : ''
  switch (source) {
    case 'spoken':
      return `Heard ${heard}.`
    case 'spoken-day':
      return `Heard ${heard} — the time is a guess.`
    case 'captured':
      return 'No date said, so it’s dated when you said it.'
    case 'assumed':
      return 'No date said — set to tomorrow morning. Change it if it’s due another time.'
  }
}
