import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import type { ContactOverview, GroupType, Interaction, Relation, WorkHistory } from '../lib/types'
import {
  api,
  useContact,
  useContactGroups,
  useContacts,
  useContactTags,
  useFacts,
  useFamily,
  useGroups,
  useInteractions,
  useMut,
  useOpenReminders,
  usePhotoUrls,
  useRelationships,
  useWorkHistory,
} from '../lib/hooks'
import { ageOf, ago, daysUntil, fmtDate, fmtDateTime, fullName, kitDueInDays, nextOccurrence } from '../lib/utils'
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

const RELATIONS: Relation[] = ['spouse', 'partner', 'child', 'parent', 'sibling', 'pet', 'other']
const GROUP_TYPES: GroupType[] = ['company', 'church', 'sports', 'school', 'club', 'nonprofit', 'family', 'other']
const EDGE_TYPES = ['knows', 'friend', 'family', 'colleague', 'introduced me', 'client', 'mentor']

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
      {upload.isPending && <p className="absolute -bottom-5 left-0 right-0 text-center text-[10px] text-slate-500">uploading…</p>}
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
  const [adding, setAdding] = useState(false)
  const [other, setOther] = useState('')
  const [relation, setRelation] = useState('knows')
  const [strength, setStrength] = useState('3')

  const byId = new Map((contacts ?? []).map((c) => [c.id, c]))
  const mine = (rels ?? []).filter((r) => r.from_contact === contactId || r.to_contact === contactId)
  const options = (contacts ?? []).filter((c) => c.id !== contactId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!other) return
    await add.mutateAsync({ from_contact: contactId, to_contact: other, relation, strength: Number(strength) })
    setOther('')
    setAdding(false)
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
      <ul className="space-y-1.5">
        {mine.map((r) => {
          const otherId = r.from_contact === contactId ? r.to_contact : r.from_contact
          const person = byId.get(otherId)
          if (!person) return null
          return (
            <li key={r.id} className="flex items-center gap-2 text-sm group">
              <Link to={`/contacts/${person.id}`} className="text-slate-200 hover:text-indigo-300">
                {fullName(person)}
              </Link>
              <span className="text-xs text-slate-500">
                {r.relation} · {'●'.repeat(r.strength)}
              </span>
              <button
                className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                onClick={() => remove.mutate(r.id)}
                aria-label="Remove connection"
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </li>
          )
        })}
        {mine.length === 0 && !adding && <li className="text-sm text-slate-600">None yet.</li>}
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
          <div className="flex gap-2">
            <select className={input} value={relation} onChange={(e) => setRelation(e.target.value)}>
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select className={input} value={strength} onChange={(e) => setStrength(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  strength {n}
                </option>
              ))}
            </select>
          </div>
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
      <ul className="space-y-1.5">
        {(family ?? []).map((f) => {
          const age = ageOf(f.birthdate, f.approx_birth_year)
          return (
            <li key={f.id} className="flex items-start gap-2 text-sm group">
              <span className="text-slate-500 capitalize w-16 shrink-0">{f.relation}</span>
              <span className="text-slate-200">
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
        {(family ?? []).length === 0 && !adding && <li className="text-sm text-slate-600">None recorded.</li>}
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

function WorkHistoryEditor({ contactId }: { contactId: string }) {
  const { data: work } = useWorkHistory(contactId)
  const add = useMut(api.addWork)
  const remove = useMut(api.deleteWork)
  const [adding, setAdding] = useState(false)
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [startYear, setStartYear] = useState('')
  const [endYear, setEndYear] = useState('')
  const [current, setCurrent] = useState(false)
  const [notes, setNotes] = useState('')

  const span = (w: WorkHistory) => {
    if (!w.start_year && !w.end_year && !w.is_current) return null
    return `${w.start_year ?? '?'}–${w.is_current ? 'now' : (w.end_year ?? '?')}`
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!company.trim()) return
    await add.mutateAsync({
      contact_id: contactId,
      company: company.trim(),
      title: title.trim() || null,
      start_year: startYear ? Number(startYear) : null,
      end_year: current || !endYear ? null : Number(endYear),
      is_current: current,
      notes: notes.trim() || null,
    })
    setCompany('')
    setTitle('')
    setStartYear('')
    setEndYear('')
    setCurrent(false)
    setNotes('')
    setAdding(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work history</h3>
        <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setAdding(!adding)}>
          {adding ? 'cancel' : '+ add'}
        </button>
      </div>
      <ul className="space-y-1.5">
        {(work ?? []).map((w) => (
          <li key={w.id} className="flex items-start gap-2 text-sm group">
            <span className="text-slate-200">
              {w.title ? `${w.title} · ` : ''}
              <span className="font-medium">{w.company}</span>
              {span(w) && <span className="text-slate-500"> — {span(w)}</span>}
              {w.is_current && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-emerald-400">current</span>}
              {w.notes && <span className="block text-xs text-slate-500">{w.notes}</span>}
            </span>
            <button
              className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
              onClick={() => remove.mutate(w.id)}
              aria-label="Remove"
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
        {(work ?? []).length === 0 && !adding && <li className="text-sm text-slate-600">None recorded.</li>}
      </ul>
      {adding && (
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
          <button type="submit" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
            Save role
          </button>
        </form>
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await update.mutateAsync({
      id: interaction.id,
      title: title.trim() || null,
      happened_at: new Date(when).toISOString(),
      location: location.trim() || null,
      notes: notes.trim() || null,
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
        placeholder="Comments — what happened, what was said, what to remember…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        autoFocus
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
      <ul className="space-y-1.5">
        {(facts ?? []).map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-sm group">
            <span className="text-slate-500 w-28 shrink-0">{f.label}</span>
            <span className="text-slate-200">{f.value}</span>
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

export function ContactProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: contact, isLoading } = useContact(id!)
  const { data: interactions } = useInteractions(id!)
  const { data: reminders } = useOpenReminders()
  const del = useMut(api.deleteContact)
  const deleteInteraction = useMut(api.deleteInteraction)
  const [editing, setEditing] = useState(false)
  const [addingReminder, setAddingReminder] = useState(false)
  const [editingInteractionId, setEditingInteractionId] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  if (isLoading) return <p className="text-slate-500 text-sm">Loading…</p>
  if (!contact) return <p className="text-slate-500 text-sm">Contact not found.</p>

  const kitDays = kitDueInDays(contact)
  const contactReminders = (reminders ?? []).filter((r) => r.contact_id === contact.id)

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
          {kitDays !== null && (
            <span className={kitDays <= 0 ? 'text-red-400 font-medium' : ''}>
              Keep in touch every {contact.keep_in_touch_days}d — {kitDays <= 0 ? `${-kitDays}d overdue` : `due in ${kitDays}d`}
            </span>
          )}
          {contact.how_we_met && <span>Met: {contact.how_we_met}{contact.met_on ? ` (${fmtDate(contact.met_on)})` : ''}</span>}
          {contact.birthday && (
            <span>
              🎂 {fmtDate(contact.birthday)}
              {ageOf(contact.birthday, null) && ` — turns ${Number(ageOf(contact.birthday, null)) + 1} in ${daysUntil(nextOccurrence(contact.birthday))}d`}
            </span>
          )}
        </div>
      </header>

      <div className="grid md:grid-cols-5 gap-4 items-start">
        {/* Personal panel */}
        <div className={`${card} p-4 space-y-5 md:col-span-2`}>
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
        <div className={`${card} p-4 md:col-span-3`}>
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
                      <button
                        className="text-xs text-slate-500 hover:text-indigo-300 mt-0.5"
                        onClick={() => setEditingInteractionId(i.id)}
                      >
                        + add comments
                      </button>
                    )}
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
