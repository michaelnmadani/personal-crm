import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GroupType } from '../lib/types'
import { api, useContacts, useGroup, useGroupMembers, useMut, usePhotoUrls } from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { GroupManager } from '../components/GroupManager'
import { Icon } from '../components/Icon'
import { btnDanger, btnGhost, btnPrimary, card, chip, input } from '../components/ui'

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
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Groups</h1>
        <Link to="/network" className="text-sm text-indigo-400 hover:underline">
          View network →
        </Link>
      </header>

      <p className="text-sm text-slate-400">
        Create, rename or delete groups, and expand one to manage who's in it. Deleting a group never deletes contacts.
      </p>

      <section className={`${card} p-4`}>
        <GroupManager />
      </section>
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
  const updateGroup = useMut(api.updateGroup)
  const deleteGroup = useMut(api.deleteGroup)
  const [adding, setAdding] = useState('')
  const [role, setRole] = useState('')
  // Null while not renaming; the draft name and type once the pencil is clicked.
  const [draft, setDraft] = useState<{ name: string; type: GroupType } | null>(null)

  if (!group) return <p className="text-slate-500 text-sm">Loading…</p>

  const memberIds = new Set((members ?? []).map((m) => m.contact_id))
  const options = (contacts ?? []).filter((c) => !memberIds.has(c.id))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adding) return
    try {
      await addMember.mutateAsync({ group_id: group.id, contact_id: adding, role: role.trim() || null })
    } catch {
      return
    }
    setAdding('')
    setRole('')
  }

  const onDelete = async () => {
    if (!window.confirm(`Delete the group “${group.name}”? Contacts stay; only the group and memberships are removed.`)) return
    try {
      await deleteGroup.mutateAsync(group.id)
    } catch {
      return
    }
    navigate('/groups')
  }

  const saveRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft?.name.trim()) return
    await updateGroup.mutateAsync({ id: group.id, name: draft.name.trim(), type: draft.type })
    setDraft(null)
  }

  return (
    <div className="space-y-4">
      <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <Icon name="back" className="w-4 h-4" /> Groups
      </Link>

      <header className={`${card} p-4`}>
        {draft ? (
          <form onSubmit={saveRename} className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} flex-1 basis-48 min-w-40`}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Group name"
              autoFocus
            />
            <select
              className={`${input} w-auto shrink-0 capitalize`}
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as GroupType })}
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
              disabled={!draft.name.trim() || updateGroup.isPending}
            >
              <Icon name="check" className="w-4 h-4" /> Save
            </button>
            <button type="button" className={`${btnGhost} shrink-0`} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <span className={`${chip} ${TYPE_STYLE[group.type]} capitalize`}>{group.type}</span>
            <h1 className="text-xl font-bold">{group.name}</h1>
            <button
              className="p-1.5 text-slate-500 hover:text-indigo-400"
              onClick={() => setDraft({ name: group.name, type: group.type })}
              aria-label="Rename group"
            >
              <Icon name="edit" className="w-4 h-4" />
            </button>
            <div className="ml-auto flex gap-2">
              <Link to={`/network?group=${group.id}`} className="text-sm text-indigo-400 hover:underline self-center">
                View in network →
              </Link>
              <button className={btnDanger} onClick={onDelete} aria-label="Delete group">
                <Icon name="trash" className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        {(updateGroup.isError || deleteGroup.isError) && (
          <p className="mt-2 text-sm text-red-400">{((updateGroup.error ?? deleteGroup.error) as Error).message}</p>
        )}
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

        {removeMember.isError && (
          <p className="mt-2 text-sm text-red-400">{(removeMember.error as Error).message}</p>
        )}

        {options.length > 0 && (
          <form onSubmit={submit} className="flex flex-wrap gap-2 mt-3 border-t border-slate-800 pt-3">
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
            {addMember.isError && <p className="w-full text-sm text-red-400">{(addMember.error as Error).message}</p>}
          </form>
        )}
      </section>
    </div>
  )
}
