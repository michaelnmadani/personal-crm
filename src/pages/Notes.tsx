import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import type { ContactOverview, InteractionKind, NoteStatus, RemarkableNote } from '../lib/types'
import { api, useContacts, useLastSyncRun, useMut, usePageImageUrls, useRemarkableNotes } from '../lib/hooks'
import { ago, fmtDateTime, fullName } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Icon, KIND_ICON } from '../components/Icon'
import { btn, btnDanger, btnGhost, btnPrimary, card, chip, input, label } from '../components/ui'

const KINDS: InteractionKind[] = ['meeting', 'call', 'email', 'message', 'event', 'note']

const STATUS: Record<NoteStatus, { text: string; tone: string }> = {
  pending: { text: 'To review', tone: 'bg-indigo-500/20 text-indigo-300' },
  approved: { text: 'Attached', tone: 'bg-emerald-500/20 text-emerald-300' },
  logged: { text: 'Log only', tone: 'bg-slate-700 text-slate-300' },
  dismissed: { text: 'Dismissed', tone: 'bg-slate-800 text-slate-500' },
  error: { text: 'Not transcribed', tone: 'bg-red-500/20 text-red-300' },
}

const when = (n: RemarkableNote) => n.event_start ?? n.written_at ?? n.created_at

/** "Ideas · p. 2 · Tue 29 Sep, 2:10 pm · emailed" */
function Source({ note }: { note: RemarkableNote }) {
  return (
    <p className="text-xs text-slate-500">
      {note.document_name ?? 'Note'}
      {note.page_number ? ` · p. ${note.page_number}` : ''} · {fmtDateTime(when(note))}
      {note.source === 'email' && ' · emailed from the tablet'}
      {note.event_title && (
        <>
          {' · '}
          <span className="text-slate-400">during “{note.event_title}”</span>
        </>
      )}
    </p>
  )
}

/**
 * The handwriting itself, so a doubtful word can be checked against the page.
 * Emailed text has no page image, so there's nothing to show.
 */
function PageImage({ note, url, onOpen }: { note: RemarkableNote; url?: string; onOpen: () => void }) {
  if (!note.image_path) return null
  if (!url) {
    return <div className="w-full md:w-44 h-32 md:h-56 md:self-start shrink-0 rounded-lg bg-slate-800/60 animate-pulse" />
  }
  return (
    <button onClick={onOpen} className="block w-full md:w-44 md:self-start shrink-0" title="Open the page">
      <img src={url} alt="Handwritten page" className="w-full max-h-72 md:max-h-none object-contain object-top rounded-lg bg-white" />
    </button>
  )
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/85 p-4 overflow-auto" onClick={onClose}>
      <img src={url} alt="Handwritten page" className="mx-auto max-w-3xl w-full bg-white rounded" />
    </div>
  )
}

/** Search every contact by name, nickname or company. */
function ContactSearch({
  contacts,
  exclude,
  onPick,
}: {
  contacts: ContactOverview[]
  exclude: string[]
  onPick: (id: string) => void
}) {
  const [text, setText] = useState('')
  const s = text.trim().toLowerCase()
  const results =
    s.length < 2
      ? []
      : contacts
          .filter((c) => !exclude.includes(c.id))
          .filter((c) => [fullName(c), c.nickname, c.company].filter(Boolean).some((v) => v!.toLowerCase().includes(s)))
          .slice(0, 8)
  return (
    <div className="relative">
      <input
        className={input}
        placeholder="Attach to someone else — search contacts…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800"
                onClick={() => {
                  onPick(c.id)
                  setText('')
                }}
              >
                <Avatar contact={c} size="sm" />
                <span className="text-slate-100">{fullName(c)}</span>
                {c.company && <span className="text-xs text-slate-500 truncate">{c.company}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One page waiting for review. Everything is editable before it goes anywhere;
 * approving attaches it to the chosen contacts as a timeline entry.
 */
function ReviewCard({
  note,
  contacts,
  byId,
  imageUrl,
  onOpenImage,
}: {
  note: RemarkableNote
  contacts: ContactOverview[]
  byId: Map<string, ContactOverview>
  imageUrl?: string
  onOpenImage: () => void
}) {
  const approve = useMut(api.approveNote)
  const setStatus = useMut(api.setNoteStatus)
  const [title, setTitle] = useState(note.title ?? '')
  const [text, setText] = useState(note.transcription ?? '')
  const [remember, setRemember] = useState(note.remember ?? '')
  const [kind, setKind] = useState<InteractionKind>('meeting')
  const [at, setAt] = useState(format(new Date(when(note)), "yyyy-MM-dd'T'HH:mm"))
  const [location, setLocation] = useState(note.event_location ?? '')
  // Start from whoever it was attached to before (a page written on again),
  // otherwise from the recommendation.
  const [selected, setSelected] = useState<string[]>(() => {
    const before = note.approved_contact_ids.filter((id) => byId.has(id))
    if (before.length) return before
    return note.recommended_contact_id && byId.has(note.recommended_contact_id) ? [note.recommended_contact_id] : []
  })

  const suggestions = note.suggestions.filter((s) => byId.has(s.contact_id))
  const recommended = suggestions.find((s) => s.contact_id === note.recommended_contact_id)
  const others = suggestions.filter((s) => !selected.includes(s.contact_id))
  const busy = approve.isPending || setStatus.isPending
  const error = approve.error ?? setStatus.error

  const submit = () =>
    approve.mutate({
      noteId: note.id,
      contactIds: selected,
      kind,
      title: title.trim() || null,
      happenedAt: new Date(at).toISOString(),
      location: location.trim() || null,
      notes: text.trim() || null,
      remember: remember.trim() || null,
    })

  return (
    <article className={`${card} p-4`}>
      <div className="flex flex-col md:flex-row gap-4">
        <PageImage note={note} url={imageUrl} onOpen={onOpenImage} />
        <div className="min-w-0 flex-1 space-y-3">
          <Source note={note} />
          {note.status === 'error' && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              Couldn't transcribe this page yet ({note.error ?? 'unknown error'}). It's retried on the next sync — or type the
              notes in yourself from the image and approve.
            </p>
          )}
          {note.interaction_id && note.revision > 1 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              You wrote more on this page after attaching it. The text below is a fresh transcription of the whole page;
              approving again updates the same timeline entry.
            </p>
          )}

          <input className={`${input} font-medium`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <div>
            <span className={label}>Notes</span>
            <textarea className={input} rows={Math.min(14, Math.max(4, text.split('\n').length + 1))} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div>
            <span className={label}>Remember — items to carry forward</span>
            <textarea className={input} rows={2} value={remember} onChange={(e) => setRemember(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
              <input type="datetime-local" className={input} value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
            <div>
              <span className={label}>Location</span>
              <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <span className={label}>Attach to</span>
            {recommended && (
              <p className="text-xs text-slate-500">
                Recommended: <span className="text-slate-300">{recommended.name}</span> — {recommended.reasons.join('; ')}
              </p>
            )}
            {!recommended && (
              <p className="text-xs text-slate-500">No recommendation — nothing on the page pointed at anyone in particular.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selected.map((id) => {
                const c = byId.get(id)!
                return (
                  <span key={id} className={`${chip} bg-indigo-600/25 text-indigo-200`}>
                    {fullName(c)}
                    <button
                      type="button"
                      className="text-indigo-300 hover:text-white"
                      onClick={() => setSelected(selected.filter((x) => x !== id))}
                      aria-label={`Remove ${fullName(c)}`}
                    >
                      <Icon name="x" className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}
              {others.map((s) => (
                <button
                  key={s.contact_id}
                  type="button"
                  title={s.reasons.join('\n')}
                  className={`${chip} border border-slate-700 text-slate-400 hover:border-indigo-400 hover:text-slate-100`}
                  onClick={() => setSelected([...selected, s.contact_id])}
                >
                  <Icon name="plus" className="w-3 h-3" />
                  {s.name}
                  {s.detail && <span className="text-slate-600">· {s.detail}</span>}
                </button>
              ))}
            </div>
            <ContactSearch contacts={contacts} exclude={selected} onPick={(id) => setSelected([...selected, id])} />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className={btnPrimary} disabled={busy || selected.length === 0} onClick={submit}>
              <Icon name="check" className="w-4 h-4" />
              {approve.isPending ? 'Adding…' : note.interaction_id ? 'Update timeline entry' : 'Approve & add to timeline'}
            </button>
            <button
              className={btnGhost}
              disabled={busy}
              onClick={() => setStatus.mutate({ id: note.id, status: 'logged' })}
              title="Keep it in the notes log without attaching it to anyone"
            >
              Keep in log only
            </button>
            <button className={`${btnDanger} ml-auto`} disabled={busy} onClick={() => setStatus.mutate({ id: note.id, status: 'dismissed' })}>
              Dismiss
            </button>
          </div>
          {error && <p className="text-sm text-red-400">{(error as Error).message}</p>}
        </div>
      </div>
    </article>
  )
}

/** A line in the full log; opens to show the page and what was transcribed. */
function LogRow({
  note,
  byId,
  imageUrl,
  onOpenImage,
}: {
  note: RemarkableNote
  byId: Map<string, ContactOverview>
  imageUrl?: string
  onOpenImage: () => void
}) {
  const [open, setOpen] = useState(false)
  const setStatus = useMut(api.setNoteStatus)
  const status = STATUS[note.status]
  const people = note.approved_contact_ids.map((id) => byId.get(id)).filter((c): c is ContactOverview => !!c)
  return (
    <li className="py-2.5">
      <button className="w-full flex items-start gap-3 text-left" onClick={() => setOpen(!open)}>
        <Icon name={KIND_ICON[note.note_type ?? ''] ?? 'note'} className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-100 truncate">{note.title || note.document_name || 'Untitled note'}</p>
          <Source note={note} />
        </div>
        <span className={`${chip} ${status.tone} shrink-0`}>{status.text}</span>
      </button>
      {open && (
        <div className="mt-3 ml-7 flex flex-col md:flex-row gap-4">
          <PageImage note={note} url={imageUrl} onOpen={onOpenImage} />
          <div className="min-w-0 flex-1 space-y-2">
            {note.summary && <p className="text-sm text-slate-400 italic">{note.summary}</p>}
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{note.transcription || '—'}</p>
            {people.length > 0 && (
              <p className="text-xs text-slate-500">
                On the timeline of{' '}
                {people.map((c, i) => (
                  <Link key={c.id} to={`/contacts/${c.id}`} className="text-indigo-400 hover:underline">
                    {i > 0 ? ', ' : ''}
                    {fullName(c)}
                  </Link>
                ))}
              </p>
            )}
            {note.status !== 'pending' && note.status !== 'error' && (
              <button
                className={btnGhost}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: note.id, status: 'pending' })}
              >
                <Icon name="refresh" className="w-4 h-4" />
                {note.status === 'approved' ? 'Review again (change who it’s attached to)' : 'Send back to review'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function SyncStatus() {
  const { data: run, isLoading } = useLastSyncRun()
  if (isLoading) return null
  if (!run) {
    return <p className="text-sm text-slate-500">Waiting for the first sync from your reMarkable.</p>
  }
  if (run.status === 'running') return <p className="text-sm text-slate-500">Syncing with your reMarkable now…</p>
  const at = run.finished_at ?? run.started_at
  if (run.status === 'ok') return <p className="text-sm text-slate-500">Last synced with your reMarkable {ago(at)}.</p>
  return (
    <p className={`text-sm ${run.status === 'error' ? 'text-red-400' : 'text-amber-300'}`} title={run.error ?? ''}>
      The last sync ({ago(at)}) {run.status === 'error' ? 'failed' : 'partly failed'}
      {run.error ? `: ${run.error.split('\n')[0]}` : '.'}
    </p>
  )
}

export function Notes() {
  const { data: notes, isLoading } = useRemarkableNotes()
  const { data: contacts } = useContacts()
  const [tab, setTab] = useState<'review' | 'all'>('review')
  const [search, setSearch] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)

  const byId = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, c])), [contacts])
  const toReview = (notes ?? []).filter((n) => n.status === 'pending' || n.status === 'error')
  const log = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return notes ?? []
    return (notes ?? []).filter((n) =>
      [n.title, n.transcription, n.document_name, n.event_title].some((v) => v?.toLowerCase().includes(s)),
    )
  }, [notes, search])
  const shown = tab === 'review' ? toReview : log
  const { data: images } = usePageImageUrls(shown.slice(0, 100).map((n) => n.image_path))
  const imageFor = (n: RemarkableNote) => (n.image_path ? images?.[n.image_path] : undefined)
  const openImage = (n: RemarkableNote) => () => {
    const url = imageFor(n)
    if (url) setLightbox(url)
  }

  const tabBtn = (id: 'review' | 'all', text: string) => (
    <button
      className={`${btn} ${tab === id ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
      onClick={() => setTab(id)}
    >
      {text}
    </button>
  )

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Notes</h1>
        <p className="text-sm text-slate-400">
          Handwriting from your reMarkable, transcribed. Nothing is added to a contact until you approve it.
        </p>
        <SyncStatus />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('review', `To review${toReview.length ? ` (${toReview.length})` : ''}`)}
        {tabBtn('all', 'All notes')}
        {tab === 'all' && (
          <input
            className={`${input} sm:max-w-xs sm:ml-auto`}
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {tab === 'review' &&
        !isLoading &&
        (toReview.length === 0 ? (
          <div className={`${card} p-8 text-center text-slate-500 text-sm`}>
            Nothing to review. New handwriting shows up here after the next sync.
          </div>
        ) : (
          <div className="space-y-4">
            {toReview.map((n) => (
              // Keyed by revision too: a page written on again resets the form.
              <ReviewCard
                key={`${n.id}-${n.revision}`}
                note={n}
                contacts={contacts ?? []}
                byId={byId}
                imageUrl={imageFor(n)}
                onOpenImage={openImage(n)}
              />
            ))}
          </div>
        ))}

      {tab === 'all' && !isLoading && (
        <section className={`${card} px-4 py-1`}>
          {log.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{search ? 'No notes match.' : 'No notes yet.'}</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {log.map((n) => (
                <LogRow key={n.id} note={n} byId={byId} imageUrl={imageFor(n)} onOpenImage={openImage(n)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
