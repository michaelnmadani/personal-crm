import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import type { Interaction, Relation, WorkHistory } from '../lib/types'
import {
  api,
  useContact,
  useContactTags,
  useFacts,
  useFamily,
  useInteractions,
  useMut,
  useOpenReminders,
  useWorkHistory,
} from '../lib/hooks'
import { ageOf, ago, daysUntil, fmtDate, fmtDateTime, fullName, kitDueInDays, nextOccurrence } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { ContactForm } from '../components/ContactForm'
import { Icon, KIND_ICON } from '../components/Icon'
import { InteractionComposer } from '../components/InteractionComposer'
import { ReminderForm } from '../components/ReminderForm'
import { ReminderItem } from '../components/ReminderItem'
import { btnDanger, btnGhost, card, chip, input } from '../components/ui'

const RELATIONS: Relation[] = ['spouse', 'partner', 'child', 'parent', 'sibling', 'pet', 'other']

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
          <Avatar contact={contact} size="lg" />
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
            <button className={btnGhost} onClick={() => setEditing(true)} aria-label="Edit">
              <Icon name="edit" className="w-4 h-4" />
            </button>
            <button className={btnDanger} onClick={onDelete} aria-label="Delete">
              <Icon name="trash" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(contact.emails.length > 0 || contact.phones.length > 0) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-sm">
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
    </div>
  )
}
