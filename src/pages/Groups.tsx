import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GroupType } from '../lib/types'
import { api, useContacts, useGroup, useGroupMembers, useGroups, useMut, usePhotoUrls } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { btnDanger, btnPrimary, card, chip, input } from '../components/ui'

const GROUP_TYPES: GroupType[] = ['company', 'church', 'sports', 'school', 'club', 'nonprofit', 'family', 'other']

const TYPE_STYLE: Record<GroupType, string> = {
  company: 'bg-indigo-500/20 text-indigo-300',
  church: 'bg-violet-500/20 text-violet-300',
  sports: 'bg-emerald-500/20 text-emerald-300',
  school: 'bg-amber-500/20 text-amber-300',
  club: 'bg-pink-500/20 text-pink-300',
  nonprofit: 'bg-teal-500/20 text-teal-300',
  family: 'bg-rose-500/20 text-rose-300',
  other: 'bg-slate-500/20 text-slate-300',
}

export function Groups() {
  const { data: groups } = useGroups()
  const create = useMut(api.createGroup)
  const [name, setName] = useState('')
  const [type, setType] = useState<GroupType>('company')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await create.mutateAsync({ name: name.trim(), type })
    setName('')
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Groups</h1>
        <Link to="/network" className="text-sm text-indigo-400 hover:underline">
          View network →
        </Link>
      </header>

      <form onSubmit={submit} className="flex gap-2">
        <input
          className={input}
          placeholder="New group — church, team, company…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className={`${input} w-auto`} value={type} onChange={(e) => setType(e.target.value as GroupType)}>
          {GROUP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className={btnPrimary} disabled={!name.trim() || create.isPending}>
          <Icon name="plus" className="w-4 h-4" /> Create
        </button>
      </form>
      {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}

      {(groups ?? []).length === 0 ? (
        <div className={`${card} p-8 text-center text-slate-500 text-sm`}>
          No groups yet. Create one above, or add a contact to a group from their profile.
        </div>
      ) : (
        <ul className={`${card} divide-y divide-slate-800`}>
          {(groups ?? []).map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="flex items-center gap-3 p-3 hover:bg-slate-800/50">
                <span className={`${chip} ${TYPE_STYLE[g.type]} capitalize`}>{g.type}</span>
                <span className="font-medium text-slate-100">{g.name}</span>
                <span className="text-xs text-slate-500 ml-auto">
                  {g.group_members?.[0]?.count ?? 0} member{(g.group_members?.[0]?.count ?? 0) === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: group } = useGroup(id!)
  const { data: members } = useGroupMembers(id!)
  const { data: contacts } = useContacts()
  const { data: photos } = usePhotoUrls((members ?? []).map((m) => m.contacts?.photo_url))
  const addMember = useMut(api.addGroupMember)
  const removeMember = useMut(api.removeGroupMember)
  const deleteGroup = useMut(api.deleteGroup)
  const [adding, setAdding] = useState('')
  const [role, setRole] = useState('')

  if (!group) return <p className="text-slate-500 text-sm">Loading…</p>

  const memberIds = new Set((members ?? []).map((m) => m.contact_id))
  const options = (contacts ?? []).filter((c) => !memberIds.has(c.id))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adding) return
    await addMember.mutateAsync({ group_id: group.id, contact_id: adding, role: role.trim() || null })
    setAdding('')
    setRole('')
  }

  const onDelete = async () => {
    if (!window.confirm(`Delete the group “${group.name}”? Contacts stay; only the group and memberships are removed.`)) return
    await deleteGroup.mutateAsync(group.id)
    navigate('/groups')
  }

  return (
    <div className="space-y-4">
      <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <Icon name="back" className="w-4 h-4" /> Groups
      </Link>

      <header className={`${card} p-4 flex items-center gap-3`}>
        <span className={`${chip} ${TYPE_STYLE[group.type]} capitalize`}>{group.type}</span>
        <h1 className="text-xl font-bold">{group.name}</h1>
        <div className="ml-auto flex gap-2">
          <Link to={`/network?group=${group.id}`} className="text-sm text-indigo-400 hover:underline self-center">
            View in network →
          </Link>
          <button className={btnDanger} onClick={onDelete} aria-label="Delete group">
            <Icon name="trash" className="w-4 h-4" />
          </button>
        </div>
      </header>

      <section className={`${card} p-4`}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Members ({(members ?? []).length})
        </h2>
        <ul className="divide-y divide-slate-800">
          {(members ?? []).map(
            (m) =>
              m.contacts && (
                <li key={m.contact_id} className="flex items-center gap-3 py-2 group">
                  <Avatar
                    contact={m.contacts}
                    size="sm"
                    src={m.contacts.photo_url ? photos?.[m.contacts.photo_url] : undefined}
                  />
                  <Link to={`/contacts/${m.contact_id}`} className="text-sm font-medium text-slate-100 hover:text-indigo-300">
                    {fullName(m.contacts)}
                  </Link>
                  {m.role && <span className="text-xs text-slate-500">{m.role}</span>}
                  <button
                    className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"
                    onClick={() => removeMember.mutate({ groupId: group.id, contactId: m.contact_id })}
                    aria-label="Remove member"
                  >
                    <Icon name="x" className="w-3.5 h-3.5" />
                  </button>
                </li>
              ),
          )}
          {(members ?? []).length === 0 && <li className="text-sm text-slate-600 py-2">No members yet.</li>}
        </ul>

        {options.length > 0 && (
          <form onSubmit={submit} className="flex gap-2 mt-3 border-t border-slate-800 pt-3">
            <select className={input} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">— add a member —</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
            <input className={input} placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
            <button type="submit" className={btnPrimary} disabled={!adding || addMember.isPending}>
              Add
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
