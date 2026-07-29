import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import type { ContactOverview, GroupType, Interaction, Relation, Reminder, WorkHistory } from '../lib/types'
import {
  api,
  useContact,
  useContactGroups,
  useContacts,
  useContactTags,
  useFacts,
  useFamily,
  useFollowUps,
  useGroups,
  useInteractions,
  useMut,
  useOpenReminders,
  usePhotoUrls,
  useRelationships,
  useWorkHistory,
} from '../lib/hooks'
import { parseLinkedInExperience, workKey, type WorkDraft } from '../lib/parseLinkedIn'
import { ageOf, ago, daysUntil, fmtBirthday, fmtDate, fmtDateTime, fullName, kitDueInDays, nextOccurrence, turningAge } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { ContactForm } from '../components/ContactForm'
import { Icon, KIND_ICON } from '../components/Icon'
import { InteractionComposer } from '../components/InteractionComposer'
import { Modal } from '../components/Modal'
import { ReminderForm } from '../components/ReminderForm'
import { ReminderItem } from '../components/ReminderItem'
import { btnDanger, btnGhost, btnPrimary, card, chip, input } from '../components/ui'

/** Score how likely `b` is a duplicate of `a`, so real duplicates surface first.
 *  Weighted toward matching surnames and first-name/initial overlap; company is a
 *  tiebreaker. Returns 0 for no meaningful overlap. */
function nameSimilarity(a: ContactOverview, b: ContactOverview): number {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const af = norm(a.first_name)
  const bf = norm(b.first_name)
  const al = norm(a.last_name)
  const bl = norm(b.last_name)
  let score = 0
  if (al && bl && al === bl) score += 6
  if (af && bf) {
    if (af === bf) score += 4
    else if (af[0] === bf[0]) score += 1
  }
  // Full-name exact match (handles single-name / no-surname contacts too).
  if (fullName(a).trim().toLowerCase() === fullName(b).trim().toLowerCase()) score += 5
  if (score > 0 && norm(a.company) && norm(a.company) === norm(b.company)) score += 1
  return score
}

/** Fold another contact into this one, keeping all information from both. */
function MergeModal({ contact, onClose }: { contact: ContactOverview; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: contacts } = useContacts()
  const merge = useMut(api.mergeContacts)
  const [loserId, setLoserId] = useState('')
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const candidates = (contacts ?? []).filter((c) => c.id !== contact.id)
  const suggested = !q
    ? candidates
        .map((c) => ({ c, s: nameSimilarity(contact, c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 50)
        .map((x) => x.c)
    : null
  const options = q
    ? candidates.filter((c) => fullName(c).toLowerCase().includes(q)).slice(0, 50)
    : suggested ?? []
  const loser = (contacts ?? []).find((c) => c.id === loserId)

  const doMerge = async () => {
    if (!loser) return
    if (!window.confirm(`Merge “${fullName(loser)}” into “${fullName(contact)}”? All of their notes, groups, connections, and details move here, and the duplicate is removed. This can’t be undone.`))
      return
    await merge.mutateAsync({ winner: contact.id, loser: loser.id })
    onClose()
    navigate(`/contacts/${contact.id}`)
  }

  return (
    <Modal title={`Merge into ${fullName(contact)}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Pick a duplicate to fold in. Everything from both profiles is kept — notes, work history, family, groups,
          connections, tags, reminders — and empty fields on <strong>{fullName(contact)}</strong> are filled from the
          other. The other contact is then removed.
        </p>
        <input className={input} placeholder="Search for the duplicate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!search.trim() && options.length > 0 && (
          <p className="text-xs text-slate-500">Likely duplicates — similar names first. Search to find anyone else.</p>
        )}
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
          {options.map((c) => (
            <button
              key={c.id}
              onClick={() => setLoserId(c.id)}
              className={`w-full flex items-center gap-2 p-2 text-left text-sm ${
                loserId === c.id ? 'bg-indigo-600/20 text-indigo-200' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Avatar contact={c} size="sm" />
              <span className="min-w-0">
                <span className="block truncate">{fullName(c)}</span>
                <span className="block text-xs text-slate-500 truncate">
                  {[c.title, c.company].filter(Boolean).join(' @ ') || '—'}
                </span>
              </span>
            </button>
          ))}
          {options.length === 0 && (
            <p className="p-3 text-sm text-slate-600">
              {search.trim() ? 'No matches.' : 'No obvious duplicates — search by name to pick anyone.'}
            </p>
          )}
        </div>
        {merge.isError && <p className="text-sm text-red-400">{(merge.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={doMerge} disabled={!loser || merge.isPending}>
            {merge.isPending ? 'Merging…' : loser ? `Merge ${fullName(loser)} in` : 'Pick a contact'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Lists of short entries — a connection, a relative, a fact — run in two
 * columns once there is room for them, so a well-filled profile doesn't push
 * everything below it far down the page.
 */
const COLUMNS = 'grid gap-x-5 gap-y-1.5 lg:grid-cols-2'

const RELATIONS: Relation[] = ['spouse', 'partner', 'child', 'parent', 'sibling', 'pet', 'other']
const GROUP_TYPES: GroupType[] = ['company', 'church', 'sports', 'school', 'club', 'nonprofit', 'family', 'other']

/** Avatar with photo upload: click to choose an image, small × to remove. */
function PhotoAvatar({ contact }: { contact: ContactOverview }) {
  const upload = useMut(api.uploadPhoto)
  const removePhoto = useMut(api.removePhoto)
  const { data: photos } = usePhotoUrls([contact.photo_url])
  const src = contact.photo_url ? photos?.[contact.photo_url] : undefined

  return (
    <div className="relative shrink-0 group/avatar">
      <label className="cursor-pointer block" title="Set photo">
        <Avatar contact={contact} size="lg" src={src} />
        <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover/avatar:opacity-100 grid place-items-center text-white transition-opacity">
          <Icon name="camera" className="w-5 h-5" />
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate({ contact, file })
            e.target.value = ''
          }}
        />
      </label>
      {contact.photo_url && (
        <button
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 grid place-items-center text-slate-400 hover:text-red-400 opacity-0 group-hover/avatar:opacity-100"
          onClick={() => removePhoto.mutate(contact)}
          aria-label="Remove photo"
        >
          <Icon name="x" className="w-3 h-3" />
        </button>
      )}
      {upload.isPending && <p className="absolute -bottom-5 left-0 right-0 text-center text-[0.625rem] text-slate-500">uploading…</p>}
    </div>
  )
}

/** Group memberships: chips linking to group pages, plus add-to-group (creates groups on the fly). */
function GroupsSection({ contactId }: { contactId: string }) {
  const { data: memberships } = useContactGroups(contactId)
  const { data: allGroups } = useGroups()
  const addTo = useMut(api.addToGroup)
  const removeFrom = useMut(api.removeGroupMember)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<GroupType>('company')
  const [role, setRole] = useState('')

  const isNewGroup = !(allGroups ?? []).some((g) => g.name.toLowerCase() === name.trim().toLowerCase())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await addTo.mutateAsync({ contactId, groupName: name, type, role: role.trim() || null })
    setName('')
    setRole('')
    setAdding(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Groups</h3>
        <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setAdding(!adding)}>
          {adding ? 'cancel' : '+ add'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(memberships ?? []).map(
          (m) =>
            m.groups && (
              <span key={m.group_id} className={`${chip} bg-slate-800 text-slate-200 group`}>
                <Link to={`/groups/${m.group_id}`} className="hover:text-indigo-300">
                  {m.groups.name}
                  {m.role && <span className="text-slate-500"> · {m.role}</span>}
                </Link>
                <button
                  onClick={() => removeFrom.mutate({ groupId: m.group_id, contactId })}
                  className="opacity-50 hover:opacity-100"
                  aria-label="Remove from group"
                >
                  <Icon name="x" className="w-2.5 h-2.5" />
                </button>
              </span>
            ),
        )}
        {(memberships ?? []).length === 0 && !adding && <span className="text-sm text-slate-600">None yet.</span>}
      </div>
      {adding && (
        <form onSubmit={submit} className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          <input
            className={input}
            placeholder="Group name — existing or new"
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="group-names"
            required
          />
          <datalist id="group-names">
            {(allGroups ?? []).map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
          <div className="flex gap-2">
            {isNewGroup && (
              <select className={input} value={type} onChange={(e) => setType(e.target.value as GroupType)}>
                {GROUP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
            <input className={input} placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
            {isNewGroup && name.trim() ? `Create “${name.trim()}” and add` : 'Add to group'}
          </button>
        </form>
      )}
    </div>
  )
}

/** Person-to-person connections (graph edges) involving this contact. */
function ConnectionsSection({ contactId }: { contactId: string }) {
  const { data: rels } = useRelationships()
  const { data: contacts } = useContacts()
  const add = useMut(api.addRelationship)
  const remove = useMut(api.deleteRelationship)
  const setNote = useMut(api.setRelationshipNote)
  const [adding, setAdding] = useState(false)
  const [other, setOther] = useState('')
  const [comment, setComment] = useState('')
  // Connection whose comment is being edited, and the draft text for it.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const byId = new Map((contacts ?? []).map((c) => [c.id, c]))
  const mine = (rels ?? []).filter((r) => r.from_contact === contactId || r.to_contact === contactId)
  const options = (contacts ?? []).filter((c) => c.id !== contactId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!other) return
    await add.mutateAsync({ from_contact: contactId, to_contact: other, notes: comment })
    setOther('')
    setComment('')
    setAdding(false)
  }

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    await setNote.mutateAsync({ id: editing, notes: draft })
    setEditing(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connections</h3>
        <div className="flex gap-2">
          <Link to={`/network?focus=${contactId}`} className="text-xs text-indigo-400 hover:text-indigo-300">
            open in network
          </Link>
          <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setAdding(!adding)}>
            {adding ? 'cancel' : '+ add'}
          </button>
        </div>
      </div>
      <ul className={COLUMNS}>
        {mine.map((r) => {
          const otherId = r.from_contact === contactId ? r.to_contact : r.from_contact
          const person = byId.get(otherId)
          if (!person) return null
          return (
            // Editing needs the room, so that one takes the full width back.
            <li key={r.id} className={`text-sm group ${editing === r.id ? 'lg:col-span-2' : ''}`}>
              <div className="flex items-center gap-2">
                <Link to={`/contacts/${person.id}`} className="text-slate-200 hover:text-indigo-300">
                  {fullName(person)}
                </Link>
                <button
                  className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-indigo-400"
                  onClick={() => {
                    setEditing(r.id)
                    setDraft(r.notes ?? '')
                  }}
                  aria-label={`Comment on connection to ${fullName(person)}`}
                >
                  <Icon name="edit" className="w-3.5 h-3.5" />
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                  onClick={() => remove.mutate(r.id)}
                  aria-label="Remove connection"
                >
                  <Icon name="x" className="w-3.5 h-3.5" />
                </button>
              </div>
              {editing === r.id ? (
                <form onSubmit={saveNote} className="flex gap-2 mt-1">
                  <input
                    className={input}
                    placeholder="Comment (optional)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0">
                    Save
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                r.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap">{r.notes}</p>
              )}
            </li>
          )
        })}
        {mine.length === 0 && !adding && <li className="text-sm text-slate-600 lg:col-span-2">None yet.</li>}
      </ul>
      {adding && (
        <form onSubmit={submit} className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          <select className={input} value={other} onChange={(e) => setOther(e.target.value)} required>
            <option value="">— pick a person —</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {fullName(c)}
              </option>
            ))}
          </select>
          <input
            className={input}
            placeholder="Comment (optional) — how do they know each other?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
            Save connection
          </button>
        </form>
      )}
    </div>
  )
}

function FamilyEditor({ contactId }: { contactId: string }) {
  const { data: family } = useFamily(contactId)
  const add = useMut(api.addFamily)
  const remove = useMut(api.deleteFamily)
  const [adding, setAdding] = useState(false)
  const [relation, setRelation] = useState<Relation>('spouse')
  const [name, setName] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [approxYear, setApproxYear] = useState('')
  const [notes, setNotes] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await add.mutateAsync({
      contact_id: contactId,
      relation,
      name: name.trim(),
      birthdate: birthdate || null,
      approx_birth_year: approxYear ? Number(approxYear) : null,
      notes: notes.trim() || null,
    })
    setName('')
    setBirthdate('')
    setApproxYear('')
    setNotes('')
    setAdding(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Family</h3>
        <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setAdding(!adding)}>
          {adding ? 'cancel' : '+ add'}
        </button>
      </div>
      <ul className={COLUMNS}>
        {(family ?? []).map((f) => {
          const age = ageOf(f.birthdate, f.approx_birth_year)
          return (
            <li key={f.id} className="flex items-start gap-2 text-sm group">
              <span className="text-slate-500 capitalize w-16 shrink-0">{f.relation}</span>
              <span className="text-slate-200 min-w-0 break-words">
                {f.name}
                {age && <span className="text-slate-500"> — {age}</span>}
                {f.notes && <span className="block text-xs text-slate-500">{f.notes}</span>}
              </span>
              <button
                className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                onClick={() => remove.mutate(f.id)}
                aria-label="Remove"
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </li>
          )
        })}
        {(family ?? []).length === 0 && !adding && (
          <li className="text-sm text-slate-600 lg:col-span-2">None recorded.</li>
        )}
      </ul>
      {adding && (
        <form onSubmit={submit} className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          <div className="flex gap-2">
            <select className={`${input} w-28`} value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <input type="date" className={input} value={birthdate} onChange={(e) => setBirthdate(e.target.value)} title="Exact birthdate (if known)" />
            <input
              type="number"
              className={input}
              placeholder="or birth year, e.g. 2017"
              value={approxYear}
              onChange={(e) => setApproxYear(e.target.value)}
            />
          </div>
          <input className={input} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
            Save family member
          </button>
        </form>
      )}
    </div>
  )
}

/**
 * The fields of one role, shared by adding a new one and editing an existing
 * one — a role is the same shape either way, and keeping one form means the
 * two can't drift apart.
 */
function RoleForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: WorkHistory
  submitLabel: string
  pending: boolean
  onSubmit: (v: Omit<WorkHistory, 'id' | 'contact_id'>) => Promise<void>
  onCancel?: () => void
}) {
  const [company, setCompany] = useState(initial?.company ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [startYear, setStartYear] = useState(initial?.start_year ? String(initial.start_year) : '')
  const [endYear, setEndYear] = useState(initial?.end_year ? String(initial.end_year) : '')
  const [current, setCurrent] = useState(initial?.is_current ?? false)
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!company.trim()) return
    await onSubmit({
      company: company.trim(),
      title: title.trim() || null,
      start_year: startYear ? Number(startYear) : null,
      end_year: current || !endYear ? null : Number(endYear),
      is_current: current,
      notes: notes.trim() || null,
    })
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 border-t border-slate-800 pt-2">
      <div className="flex gap-2">
        <input className={input} placeholder="Company *" value={company} onChange={(e) => setCompany(e.target.value)} required />
        <input className={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          className={input}
          placeholder="From year"
          value={startYear}
          onChange={(e) => setStartYear(e.target.value)}
        />
        <input
          type="number"
          className={input}
          placeholder="To year"
          value={endYear}
          onChange={(e) => setEndYear(e.target.value)}
          disabled={current}
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
          current
        </label>
      </div>
      <input className={input} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-3">
        <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="text-xs text-slate-500 hover:text-slate-300" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/**
 * Paste a LinkedIn Experience block and turn it into work-history entries.
 *
 * Everything the parser produces is shown as an editable row first: a paste is
 * a guess about somebody else's formatting, so nothing reaches the database
 * until it has been looked at. Rows already saved against this contact arrive
 * unticked and labelled, so pasting an updated profile adds only what's new.
 */
function PasteWorkHistory({
  contactId,
  existing,
  onDone,
}: {
  contactId: string
  existing: WorkHistory[]
  onDone: () => void
}) {
  const addBatch = useMut(api.addWorkBatch)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<{ draft: WorkDraft; take: boolean; dupe: boolean }[] | null>(null)

  const alreadyHave = useMemo(() => new Set(existing.map(workKey)), [existing])

  const parse = () => {
    const drafts = parseLinkedInExperience(text)
    setRows(
      drafts.map((draft) => {
        const dupe = alreadyHave.has(workKey(draft))
        return { draft, take: !dupe, dupe }
      }),
    )
  }

  const patch = (i: number, v: Partial<WorkDraft>) =>
    setRows((prev) => prev && prev.map((r, k) => (k === i ? { ...r, draft: { ...r.draft, ...v } } : r)))

  const save = async () => {
    const keep = (rows ?? []).filter((r) => r.take && r.draft.company.trim())
    if (keep.length === 0) return
    await addBatch.mutateAsync(
      keep.map((r) => ({
        contact_id: contactId,
        company: r.draft.company.trim(),
        title: r.draft.title?.trim() || null,
        start_year: r.draft.start_year,
        end_year: r.draft.is_current ? null : r.draft.end_year,
        is_current: r.draft.is_current,
        notes: null,
        raw_period: r.draft.raw_period,
      })),
    )
    onDone()
  }

  const taking = (rows ?? []).filter((r) => r.take).length
  const dupes = (rows ?? []).filter((r) => r.dupe).length

  return (
    <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
      {rows === null ? (
        <>
          <textarea
            className={`${input} h-32 font-mono text-xs`}
            placeholder="Paste the Experience section from their LinkedIn profile…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-3">
            <button
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              onClick={parse}
              disabled={!text.trim()}
            >
              Read it
            </button>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      ) : rows.length === 0 ? (
        <>
          <p className="text-sm text-red-400">
            Couldn't find any roles in that. Each one needs a line with its years, like "Mar 2019 - Present".
          </p>
          <div className="flex gap-3">
            <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setRows(null)}>
              Back to the text
            </button>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Found {rows.length} role{rows.length === 1 ? '' : 's'}
            {dupes > 0 && ` · ${dupes} already saved, unticked`}. Edit anything that came out wrong, then save.
          </p>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className={`flex gap-2 ${r.take ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={r.take}
                  onChange={(e) => setRows((prev) => prev && prev.map((x, k) => (k === i ? { ...x, take: e.target.checked } : x)))}
                  className="mt-2 w-4 h-4 shrink-0 accent-indigo-600"
                  aria-label={`Save ${r.draft.company}`}
                />
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex gap-1.5">
                    <input
                      className={`${input} text-sm`}
                      value={r.draft.company}
                      onChange={(e) => patch(i, { company: e.target.value })}
                      placeholder="Company *"
                      aria-label="Company"
                    />
                    <input
                      className={`${input} text-sm`}
                      value={r.draft.title ?? ''}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      placeholder="Title"
                      aria-label="Title"
                    />
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <input
                      type="number"
                      className={`${input} text-sm`}
                      value={r.draft.start_year ?? ''}
                      onChange={(e) => patch(i, { start_year: e.target.value ? Number(e.target.value) : null })}
                      placeholder="From"
                      aria-label="From year"
                    />
                    <input
                      type="number"
                      className={`${input} text-sm`}
                      value={r.draft.end_year ?? ''}
                      onChange={(e) => patch(i, { end_year: e.target.value ? Number(e.target.value) : null })}
                      placeholder="To"
                      disabled={r.draft.is_current}
                      aria-label="To year"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
                      <input
                        type="checkbox"
                        checked={r.draft.is_current}
                        onChange={(e) => patch(i, { is_current: e.target.checked })}
                      />
                      current
                    </label>
                  </div>
                  <p className="text-[0.6875rem] text-slate-600">
                    from “{r.draft.raw_period}”{r.dupe && ' · already saved'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {addBatch.isError && <p className="text-sm text-red-400">{(addBatch.error as Error).message}</p>}
          <div className="flex gap-3">
            <button
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              onClick={save}
              disabled={taking === 0 || addBatch.isPending}
            >
              Save {taking} role{taking === 1 ? '' : 's'}
            </button>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setRows(null)}>
              Back to the text
            </button>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function WorkHistoryEditor({ contactId }: { contactId: string }) {
  const { data: work } = useWorkHistory(contactId)
  const add = useMut(api.addWork)
  const update = useMut(api.updateWork)
  const remove = useMut(api.deleteWork)
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const span = (w: WorkHistory) => {
    if (!w.start_year && !w.end_year && !w.is_current) return null
    return `${w.start_year ?? '?'}–${w.is_current ? 'now' : (w.end_year ?? '?')}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work history</h3>
        <div className="flex gap-2">
          <button
            className="text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => {
              setPasting(!pasting)
              setAdding(false)
              setEditing(null)
            }}
            title="Paste the Experience section straight off a LinkedIn profile"
          >
            {pasting ? 'cancel' : 'paste from LinkedIn'}
          </button>
          <button
            className="text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => {
              setAdding(!adding)
              setPasting(false)
              setEditing(null)
            }}
          >
            {adding ? 'cancel' : '+ add'}
          </button>
        </div>
      </div>
      {pasting && (
        <PasteWorkHistory contactId={contactId} existing={work ?? []} onDone={() => setPasting(false)} />
      )}
      <ul className="space-y-1.5">
        {(work ?? []).map((w) =>
          editing === w.id ? (
            <li key={w.id}>
              <RoleForm
                initial={w}
                submitLabel="Save changes"
                pending={update.isPending}
                onCancel={() => setEditing(null)}
                onSubmit={async (v) => {
                  await update.mutateAsync({ id: w.id, ...v })
                  setEditing(null)
                }}
              />
            </li>
          ) : (
            <li key={w.id} className="flex items-start gap-2 text-sm group">
              <span className="text-slate-200">
                {w.title ? `${w.title} · ` : ''}
                <span className="font-medium">{w.company}</span>
                {span(w) && <span className="text-slate-500"> — {span(w)}</span>}
                {w.is_current && <span className="ml-1.5 text-[0.625rem] uppercase tracking-wide text-emerald-400">current</span>}
                {w.notes && <span className="block text-xs text-slate-500">{w.notes}</span>}
              </span>
              <button
                className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-indigo-400"
                onClick={() => {
                  setEditing(w.id)
                  setAdding(false)
                }}
                aria-label={`Edit role ${w.title ? `${w.title} at ` : ''}${w.company}`}
              >
                <Icon name="edit" className="w-3.5 h-3.5" />
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                onClick={() => remove.mutate(w.id)}
                aria-label="Remove"
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </li>
          ),
        )}
        {(work ?? []).length === 0 && !adding && <li className="text-sm text-slate-600">None recorded.</li>}
      </ul>
      {adding && (
        <RoleForm
          submitLabel="Save role"
          pending={add.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            await add.mutateAsync({ contact_id: contactId, ...v })
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

/** Inline editor for a timeline entry — lets you backfill or correct comments, date, title, location. */
function EditInteraction({ interaction, onClose }: { interaction: Interaction; onClose: () => void }) {
  const update = useMut(api.updateInteraction)
  const [title, setTitle] = useState(interaction.title ?? '')
  const [when, setWhen] = useState(format(new Date(interaction.happened_at), "yyyy-MM-dd'T'HH:mm"))
  const [location, setLocation] = useState(interaction.location ?? '')
  const [notes, setNotes] = useState(interaction.notes ?? '')
  const [remember, setRemember] = useState(interaction.remember ?? '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await update.mutateAsync({
      id: interaction.id,
      title: title.trim() || null,
      happened_at: new Date(when).toISOString(),
      location: location.trim() || null,
      notes: notes.trim() || null,
      remember: remember.trim() || null,
    })
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex-1 space-y-2 border border-slate-700 rounded-lg p-3">
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <input className={input} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
      <textarea
        className={input}
        rows={4}
        placeholder="Notes — what happened, what was said…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        autoFocus
      />
      <textarea
        className={input}
        rows={2}
        placeholder="Remember — key takeaways, promises, next steps, personal details to recall…"
        value={remember}
        onChange={(e) => setRemember(e.target.value)}
      />
      {update.isError && <p className="text-sm text-red-400">{(update.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function FactsEditor({ contactId }: { contactId: string }) {
  const { data: facts } = useFacts(contactId)
  const add = useMut(api.addFact)
  const remove = useMut(api.deleteFact)
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim() || !value.trim()) return
    await add.mutateAsync({ contact_id: contactId, label: label.trim(), value: value.trim() })
    setLabel('')
    setValue('')
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Details & facts</h3>
      <ul className={COLUMNS}>
        {(facts ?? []).map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-sm group">
            <span className="text-slate-500 w-24 shrink-0 truncate" title={f.label}>
              {f.label}
            </span>
            <span className="text-slate-200 min-w-0 break-words">{f.value}</span>
            <button
              className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
              onClick={() => remove.mutate(f.id)}
              aria-label="Remove"
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2 mt-2">
        <input className={`${input} w-28`} placeholder="Hobby…" value={label} onChange={(e) => setLabel(e.target.value)} list="fact-labels" />
        <datalist id="fact-labels">
          {['Hobby', 'Favorite restaurant', 'Favorite drink', 'Alma mater', 'Allergy', 'Hometown', 'Sports team'].map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <input className={input} placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="text-indigo-400 hover:text-indigo-300" aria-label="Add fact">
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}

function TagRow({ contactId }: { contactId: string }) {
  const { data: tags } = useContactTags(contactId)
  const addTag = useMut(api.addTag)
  const removeTag = useMut(api.removeTag)
  const [text, setText] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await addTag.mutateAsync({ contactId, name: text })
    setText('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(tags ?? []).map(
        (ct) =>
          ct.tags && (
            <span key={ct.tag_id} className={`${chip} group`} style={{ background: `${ct.tags.color}26`, color: ct.tags.color }}>
              {ct.tags.name}
              <button
                onClick={() => removeTag.mutate({ contactId, tagId: ct.tag_id })}
                className="opacity-50 hover:opacity-100"
                aria-label="Remove tag"
              >
                <Icon name="x" className="w-2.5 h-2.5" />
              </button>
            </span>
          ),
      )}
      <form onSubmit={submit}>
        <input
          className="bg-transparent border border-dashed border-slate-700 rounded-full px-2.5 py-0.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 w-24"
          placeholder="+ tag"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </div>
  )
}

/**
 * The follow-up promised when a timeline entry was written, shown against it —
 * and closable from there, since that is where you see it was owed.
 */
function FollowUp({ reminder }: { reminder: Reminder }) {
  const complete = useMut(api.completeReminder)
  const done = reminder.status === 'done'
  const days = daysUntil(new Date(reminder.due_at))
  return (
    <div
      className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        done ? 'border-slate-700 text-slate-500' : 'border-indigo-500/40 bg-indigo-500/10'
      }`}
    >
      <Icon name={done ? 'check' : 'bell'} className={`w-3.5 h-3.5 shrink-0 ${done ? '' : 'text-indigo-400'}`} />
      {done ? (
        <span>Followed up {reminder.completed_at ? ago(reminder.completed_at) : ''}</span>
      ) : (
        <>
          <span className="text-slate-100">
            Follow up {fmtDate(reminder.due_at)}
            {days === 0 ? ' · today' : days > 0 ? ` · in ${days}d` : ` · ${-days}d overdue`}
          </span>
          <button
            className="text-slate-500 hover:text-emerald-400"
            onClick={() => complete.mutate(reminder)}
            aria-label="Mark follow-up done"
            title="Done"
          >
            <Icon name="check" className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

export function ContactProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: contact, isLoading } = useContact(id!)
  const { data: interactions } = useInteractions(id!)
  const { data: reminders } = useOpenReminders()
  const { data: followUps } = useFollowUps(id!)
  const del = useMut(api.deleteContact)
  const setFavorite = useMut(api.setFavorite)
  const deleteInteraction = useMut(api.deleteInteraction)
  const [editing, setEditing] = useState(false)
  const [addingReminder, setAddingReminder] = useState(false)
  const [editingInteractionId, setEditingInteractionId] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  if (isLoading) return <p className="text-slate-500 text-sm">Loading…</p>
  if (!contact) return <p className="text-slate-500 text-sm">Contact not found.</p>

  const kitDays = kitDueInDays(contact)
  const contactReminders = (reminders ?? []).filter((r) => r.contact_id === contact.id)
  const followUpOf = new Map((followUps ?? []).map((r) => [r.interaction_id, r]))

  const onDelete = async () => {
    if (!window.confirm(`Delete ${fullName(contact)} and all their notes, reminders, and details? This cannot be undone.`)) return
    await del.mutateAsync(contact.id)
    navigate('/contacts')
  }

  return (
    <div className="space-y-4">
      <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <Icon name="back" className="w-4 h-4" /> Contacts
      </Link>

      {/* Header */}
      <header className={`${card} p-5`}>
        <div className="flex items-start gap-4">
          <PhotoAvatar contact={contact} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
              {fullName(contact)}
              {contact.nickname && <span className="text-slate-500 font-normal">“{contact.nickname}”</span>}
              <span className={`${chip} bg-slate-800 text-slate-400 capitalize`}>{contact.kind}</span>
            </h1>
            {(contact.title || contact.company) && (
              <p className="text-sm text-slate-400">{[contact.title, contact.company].filter(Boolean).join(' @ ')}</p>
            )}
            {contact.location && <p className="text-xs text-slate-500">{contact.location}</p>}
            <div className="mt-2">
              <TagRow contactId={contact.id} />
            </div>
          </div>
          <div className="flex gap-1">
            <button
              className={contact.favorite ? btnGhost + ' text-amber-400' : btnGhost}
              onClick={() => setFavorite.mutate({ id: contact.id, favorite: !contact.favorite })}
              aria-label={contact.favorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={contact.favorite}
              title={contact.favorite ? 'Favourited — shown first in Contacts' : 'Favourite (show first in Contacts)'}
            >
              <Icon name="star" className="w-4 h-4" filled={contact.favorite} />
            </button>
            <button className={btnGhost} onClick={() => setMerging(true)} aria-label="Merge duplicate" title="Merge a duplicate into this contact">
              <Icon name="merge" className="w-4 h-4" />
            </button>
            <button className={btnGhost} onClick={() => setEditing(true)} aria-label="Edit">
              <Icon name="edit" className="w-4 h-4" />
            </button>
            <button className={btnDanger} onClick={onDelete} aria-label="Delete">
              <Icon name="trash" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(contact.emails.length > 0 || contact.phones.length > 0 || contact.website || contact.linkedin_url) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-sm">
            {contact.linkedin_url && (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-indigo-400 hover:underline"
              >
                <Icon name="linkedin" className="w-3.5 h-3.5" /> LinkedIn
              </a>
            )}
            {contact.website && (
              <a
                href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-indigo-400 hover:underline"
              >
                <Icon name="link" className="w-3.5 h-3.5" /> Website
              </a>
            )}
            {contact.emails.map((e, i) => (
              <a key={`e${i}`} href={`mailto:${e.value}`} className="flex items-center gap-1.5 text-indigo-400 hover:underline">
                <Icon name="mail" className="w-3.5 h-3.5" /> {e.value}
              </a>
            ))}
            {contact.phones.map((p, i) => (
              <a key={`p${i}`} href={`tel:${p.value}`} className="flex items-center gap-1.5 text-indigo-400 hover:underline">
                <Icon name="phone" className="w-3.5 h-3.5" /> {p.value}
              </a>
            ))}
          </div>
        )}

        {contact.summary && <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap">{contact.summary}</p>}

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          {contact.last_contacted ? <span>Last contact {ago(contact.last_contacted)}</span> : <span>No contact logged yet</span>}
          <span title={fmtDateTime(contact.last_modified)}>Last modified {ago(contact.last_modified)}</span>
          {kitDays !== null && (
            <span className={kitDays <= 0 ? 'text-red-400 font-medium' : ''}>
              Keep in touch every {contact.keep_in_touch_days}d — {kitDays <= 0 ? `${-kitDays}d overdue` : `due in ${kitDays}d`}
            </span>
          )}
          {contact.how_we_met && <span>Met: {contact.how_we_met}{contact.met_on ? ` (${fmtDate(contact.met_on)})` : ''}</span>}
          {contact.birthday && (
            <span>
              🎂 {fmtBirthday(contact.birthday, contact.birthday_has_year)}
              {(() => {
                const turns = turningAge(contact.birthday, contact.birthday_has_year)
                const days = daysUntil(nextOccurrence(contact.birthday))
                return turns !== null ? ` — turns ${turns} in ${days}d` : ` — in ${days}d`
              })()}
            </span>
          )}
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* Personal panel */}
        <div className={`${card} p-4 space-y-5`}>
          <GroupsSection contactId={contact.id} />
          <ConnectionsSection contactId={contact.id} />
          <WorkHistoryEditor contactId={contact.id} />
          <FamilyEditor contactId={contact.id} />
          <FactsEditor contactId={contact.id} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reminders</h3>
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setAddingReminder(true)}>
                + add
              </button>
            </div>
            {contactReminders.length === 0 ? (
              <p className="text-sm text-slate-600">None open.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {contactReminders.map((r) => (
                  <ReminderItem key={r.id} reminder={r} showContact={false} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className={`${card} p-4`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Timeline</h3>
          <InteractionComposer contactId={contact.id} contactName={contact.first_name} />
          <ul className="mt-4 space-y-4">
            {(interactions ?? []).map((i) => {
              const others = (i.participants ?? []).filter((p) => p.contact_id !== contact.id && p.contacts)
              if (i.id === editingInteractionId) {
                return (
                  <li key={i.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 grid place-items-center shrink-0 text-slate-400">
                      <Icon name={KIND_ICON[i.kind]} className="w-4 h-4" />
                    </div>
                    <EditInteraction interaction={i} onClose={() => setEditingInteractionId(null)} />
                  </li>
                )
              }
              return (
                <li key={i.id} className="flex gap-3 group">
                  <div className="w-8 h-8 rounded-full bg-slate-800 grid place-items-center shrink-0 text-slate-400">
                    <Icon name={KIND_ICON[i.kind]} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {i.title && <span className="font-medium text-slate-100">{i.title} · </span>}
                      <span className="text-slate-500 text-xs">
                        {fmtDateTime(i.happened_at)}
                        {i.location && ` · ${i.location}`}
                      </span>
                    </p>
                    {i.notes ? (
                      <p className="text-sm text-slate-300 whitespace-pre-wrap mt-0.5">{i.notes}</p>
                    ) : (
                      !i.remember && (
                        <button
                          className="text-xs text-slate-500 hover:text-indigo-300 mt-0.5"
                          onClick={() => setEditingInteractionId(i.id)}
                        >
                          + add notes
                        </button>
                      )
                    )}
                    {i.remember && (
                      <div className="mt-1.5 flex gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                        <Icon name="star" className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" filled />
                        <div className="min-w-0">
                          <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-amber-600">Remember</p>
                          {/* slate-100 is the theme's primary text token — dark on
                              light themes, light on dark ones — so this stays readable. */}
                          <p className="text-sm text-slate-100 whitespace-pre-wrap">{i.remember}</p>
                        </div>
                      </div>
                    )}
                    {followUpOf.get(i.id) && <FollowUp reminder={followUpOf.get(i.id)!} />}
                    {others.length > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        with{' '}
                        {others.map((p, idx) => (
                          <Link key={p.contact_id} to={`/contacts/${p.contacts!.id}`} className="text-indigo-400 hover:underline">
                            {idx > 0 ? ', ' : ''}
                            {fullName(p.contacts!)}
                          </Link>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 self-start opacity-0 group-hover:opacity-100">
                    <button
                      className="text-slate-600 hover:text-indigo-300"
                      onClick={() => setEditingInteractionId(i.id)}
                      aria-label="Edit entry"
                      title="Edit / backfill comments"
                    >
                      <Icon name="edit" className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="text-slate-600 hover:text-red-400"
                      onClick={() => deleteInteraction.mutate(i.id)}
                      aria-label="Delete entry"
                    >
                      <Icon name="trash" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
            {(interactions ?? []).length === 0 && (
              <li className="text-sm text-slate-600">No history yet — log your first note above.</li>
            )}
          </ul>
        </div>
      </div>

      {editing && <ContactForm contact={contact} onClose={() => setEditing(false)} />}
      {addingReminder && <ReminderForm contactId={contact.id} onClose={() => setAddingReminder(false)} />}
      {merging && <MergeModal contact={contact} onClose={() => setMerging(false)} />}
    </div>
  )
}
