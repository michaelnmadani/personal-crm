import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GroupType } from '../lib/types'
import {
  api,
  useAllWorkHistory,
  useContacts,
  useGroupCompanies,
  useGroupMembers,
  useGroups,
  useMut,
  usePhotoUrls,
} from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { btnGhost, btnPrimary, chip, input } from './ui'

const GROUP_TYPES: GroupType[] = ['company', 'church', 'sports', 'school', 'club', 'nonprofit', 'family', 'other']

/** Same look as `input` but without its w-full, for controls sized to content. */
const FIELD =
  'rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500'

/**
 * Tint identifies the type; the *text* uses the theme's own foreground so it
 * stays readable everywhere. Only slate and indigo are remapped per theme, so
 * coloured label text (pink-300 and friends) washes out on the light themes.
 */
const TYPE_STYLE: Record<GroupType, string> = {
  company: 'bg-indigo-500/20',
  church: 'bg-violet-500/25',
  sports: 'bg-emerald-500/25',
  school: 'bg-amber-500/25',
  club: 'bg-pink-500/25',
  nonprofit: 'bg-teal-500/25',
  family: 'bg-rose-500/25',
  other: 'bg-slate-500/25',
}

/**
 * Company names that roll up into this group. Several names for the same
 * employer ("Macquarie Group", "Macquarie Bank") map onto one group and then
 * draw as a single hub on the network chart instead of separate companies.
 */
function GroupCompanies({ groupId }: { groupId: string }) {
  const { data: mapped } = useGroupCompanies()
  const { data: contacts } = useContacts()
  const { data: allWork } = useAllWorkHistory()
  const addCompany = useMut(api.addGroupCompany)
  const removeCompany = useMut(api.removeGroupCompany)
  const [find, setFind] = useState('')

  const mine = (mapped ?? []).filter((m) => m.group_id === groupId)
  // Names already spoken for anywhere — a company belongs to one group only.
  const taken = useMemo(() => new Set((mapped ?? []).map((m) => m.company.toLowerCase())), [mapped])

  // Every company name in the address book, from current employer and history.
  const known = useMemo(() => {
    const s = new Map<string, string>()
    for (const c of contacts ?? []) if (c.company?.trim()) s.set(c.company.trim().toLowerCase(), c.company.trim())
    for (const w of allWork ?? []) if (w.company?.trim()) s.set(w.company.trim().toLowerCase(), w.company.trim())
    return [...s.values()].sort((a, b) => a.localeCompare(b))
  }, [contacts, allWork])

  const matches = useMemo(() => {
    const s = find.trim().toLowerCase()
    if (!s) return []
    return known.filter((n) => !taken.has(n.toLowerCase()) && n.toLowerCase().includes(s)).slice(0, 6)
  }, [find, known, taken])

  const add = async (company: string) => {
    await addCompany.mutateAsync({ group_id: groupId, company })
    setFind('')
  }

  return (
    <div className="space-y-2 border-t border-slate-800 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Companies</p>
      {mine.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {mine.map((m) => (
            <li key={m.id} className={`${chip} bg-slate-500/25 text-slate-100 flex items-center gap-1.5`}>
              {m.company}
              <button
                onClick={() => removeCompany.mutate(m.id)}
                className="text-slate-400 hover:text-red-400"
                aria-label={`Unmap ${m.company} from group`}
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          No companies mapped. Add the names of the same employer to show them as one on the network chart.
        </p>
      )}

      <div className="relative">
        <input
          className={input}
          placeholder="Map a company — start typing a name…"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
            {matches.map((n) => (
              <li key={n}>
                <button className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800" onClick={() => add(n)}>
                  {n}
                </button>
              </li>
            ))}
          </ul>
        )}
        {find.trim() && matches.length === 0 && (
          <p className="mt-1 text-sm text-slate-500">
            {taken.has(find.trim().toLowerCase())
              ? `“${find.trim()}” is already mapped to a group.`
              : `No company matches “${find.trim()}”.`}
          </p>
        )}
      </div>
      {addCompany.isError && <p className="text-sm text-red-400">{(addCompany.error as Error).message}</p>}
    </div>
  )
}

/**
 * Members of one group, with add and remove. Split into its own component so
 * the members query only runs for the group that's actually expanded — there's
 * no point fetching memberships for every group in the list.
 */
function GroupMembers({ groupId }: { groupId: string }) {
  const { data: members } = useGroupMembers(groupId)
  const { data: contacts } = useContacts()
  const { data: photos } = usePhotoUrls((members ?? []).map((m) => m.contacts?.photo_url))
  const addMember = useMut(api.addGroupMember)
  const removeMember = useMut(api.removeGroupMember)
  const [find, setFind] = useState('')

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.contact_id)), [members])

  // A dropdown of a thousand contacts is unusable, so type to narrow instead
  // and pick from the first handful of matches.
  const matches = useMemo(() => {
    const s = find.trim().toLowerCase()
    if (!s) return []
    return (contacts ?? [])
      .filter((c) => !memberIds.has(c.id) && fullName(c).toLowerCase().includes(s))
      .slice(0, 6)
  }, [find, contacts, memberIds])

  const add = async (contactId: string) => {
    await addMember.mutateAsync({ group_id: groupId, contact_id: contactId, role: null })
    setFind('')
  }

  return (
    <div className="px-3 pb-3 space-y-2">
      <ul className="divide-y divide-slate-800">
        {(members ?? []).map(
          (m) =>
            m.contacts && (
              <li key={m.contact_id} className="flex items-center gap-2 py-1.5">
                <Avatar
                  contact={m.contacts}
                  size="sm"
                  src={m.contacts.photo_url ? photos?.[m.contacts.photo_url] : undefined}
                />
                <Link to={`/contacts/${m.contact_id}`} className="text-sm text-slate-100 hover:text-indigo-300">
                  {fullName(m.contacts)}
                </Link>
                {m.role && <span className="text-xs text-slate-500">{m.role}</span>}
                <button
                  className="ml-auto p-1 text-slate-500 hover:text-red-400"
                  onClick={() => removeMember.mutate({ groupId, contactId: m.contact_id })}
                  aria-label={`Remove ${fullName(m.contacts)} from group`}
                >
                  <Icon name="x" className="w-3.5 h-3.5" />
                </button>
              </li>
            ),
        )}
        {(members ?? []).length === 0 && <li className="py-1.5 text-sm text-slate-500">No members yet.</li>}
      </ul>

      <div className="relative">
        <input
          className={input}
          placeholder="Add someone — start typing a name…"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => add(c.id)}
                >
                  {fullName(c)}
                  {c.company && <span className="text-slate-500"> · {c.company}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {find.trim() && matches.length === 0 && (
          <p className="mt-1 text-sm text-slate-500">No one matches “{find.trim()}”.</p>
        )}
      </div>

      <GroupCompanies groupId={groupId} />
    </div>
  )
}

/**
 * Create, delete and populate groups without leaving Settings. Expanding a
 * group reveals its members, so adding or removing people is one click away.
 */
export function GroupManager() {
  const { data: groups } = useGroups()
  const create = useMut(api.createGroup)
  const update = useMut(api.updateGroup)
  const remove = useMut(api.deleteGroup)
  const [name, setName] = useState('')
  const [type, setType] = useState<GroupType>('company')
  const [open, setOpen] = useState<string | null>(null)
  // The group being renamed plus its draft values. Kept here rather than in the
  // row so cancelling just drops them and the saved name comes straight back.
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState<GroupType>('company')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const g = await create.mutateAsync({ name: name.trim(), type })
    setName('')
    setOpen(g.id) // jump straight to adding people to what you just made
  }

  const startEdit = (g: { id: string; name: string; type: GroupType }) => {
    setEditing(g.id)
    setDraftName(g.name)
    setDraftType(g.type)
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !draftName.trim()) return
    await update.mutateAsync({ id: editing, name: draftName.trim(), type: draftType })
    setEditing(null)
  }

  const onDelete = async (id: string, label: string) => {
    if (!window.confirm(`Delete the group “${label}”? Contacts stay; only the group and its memberships are removed.`))
      return
    await remove.mutateAsync(id)
    if (open === id) setOpen(null)
    if (editing === id) setEditing(null)
  }

  return (
    <div className="space-y-3">
      {/* `input` carries w-full, which in a wrapping flex row pushes every
          control onto its own line — so the name field grows and the other two
          are sized to their content instead. */}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          className={`${input} flex-1 basis-48 min-w-40`}
          placeholder="New group — church, team, company…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={`${FIELD} shrink-0 capitalize`}
          value={type}
          onChange={(e) => setType(e.target.value as GroupType)}
        >
          {GROUP_TYPES.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className={`${btnPrimary} shrink-0`} disabled={!name.trim() || create.isPending}>
          <Icon name="plus" className="w-4 h-4" /> Create
        </button>
      </form>
      {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}
      {update.isError && <p className="text-sm text-red-400">{(update.error as Error).message}</p>}

      {(groups ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No groups yet. Create one above.</p>
      ) : (
        <ul className="rounded-lg border border-slate-800 divide-y divide-slate-800">
          {(groups ?? []).map((g) => {
            const count = g.group_members?.[0]?.count ?? 0
            const expanded = open === g.id
            return (
              <li key={g.id}>
                {editing === g.id ? (
                  <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2 p-2">
                    <input
                      className={`${input} flex-1 basis-48 min-w-40`}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      aria-label="Group name"
                      autoFocus
                    />
                    <select
                      className={`${FIELD} shrink-0 capitalize`}
                      value={draftType}
                      onChange={(e) => setDraftType(e.target.value as GroupType)}
                      aria-label="Group type"
                    >
                      {GROUP_TYPES.map((t) => (
                        <option key={t} value={t} className="capitalize">
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className={`${btnPrimary} shrink-0`}
                      disabled={!draftName.trim() || update.isPending}
                    >
                      <Icon name="check" className="w-4 h-4" /> Save
                    </button>
                    <button type="button" className={`${btnGhost} shrink-0`} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 p-2">
                    {/* Caret manages the group here; the name opens its own page.
                        A Link can't live inside a button, so they're siblings. */}
                    <button
                      className="p-1 shrink-0 text-slate-500 hover:text-slate-300"
                      onClick={() => setOpen(expanded ? null : g.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} group ${g.name}`}
                    >
                      <Icon name="back" className={`w-3.5 h-3.5 ${expanded ? '-rotate-90' : 'rotate-180'}`} />
                    </button>
                    <span className={`${chip} ${TYPE_STYLE[g.type]} text-slate-100 capitalize shrink-0`}>
                      {g.type}
                    </span>
                    <Link
                      to={`/groups/${g.id}`}
                      className="text-sm font-medium text-slate-100 truncate hover:text-indigo-300"
                    >
                      {g.name}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-slate-500">
                      {count} member{count === 1 ? '' : 's'}
                    </span>
                    <button
                      className="p-1.5 text-slate-500 hover:text-indigo-400"
                      onClick={() => startEdit(g)}
                      aria-label={`Rename group ${g.name}`}
                    >
                      <Icon name="edit" className="w-4 h-4" />
                    </button>
                    <button
                      className="p-1.5 text-slate-500 hover:text-red-400"
                      onClick={() => onDelete(g.id, g.name)}
                      aria-label={`Delete group ${g.name}`}
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {expanded && editing !== g.id && <GroupMembers groupId={g.id} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
