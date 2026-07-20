import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useAllContactTags, useContacts, useMut, usePhotoUrls } from '../lib/hooks'
import { ago, fullName, kitOverdue } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { btnPrimary, card, chip, input } from '../components/ui'

type Filter = 'all' | 'business' | 'personal' | 'overdue'
type Sort = 'name' | 'recent' | 'added'

export function Contacts() {
  const { data: contacts, isLoading } = useContacts()
  const { data: allTags } = useAllContactTags()
  const { data: photos } = usePhotoUrls((contacts ?? []).map((c) => c.photo_url))
  const quickAdd = useMut(api.quickAddContact)
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [newName, setNewName] = useState('')

  const tagsByContact = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }[]>()
    for (const ct of allTags ?? []) {
      if (!ct.tags) continue
      const list = m.get(ct.contact_id) ?? []
      list.push(ct.tags)
      m.set(ct.contact_id, list)
    }
    return m
  }, [allTags])

  const list = useMemo(() => {
    let l = contacts ?? []
    if (filter === 'business' || filter === 'personal') l = l.filter((c) => c.kind === filter || c.kind === 'both')
    if (filter === 'overdue') l = l.filter(kitOverdue)
    if (search.trim()) {
      const s = search.toLowerCase()
      l = l.filter((c) =>
        [fullName(c), c.nickname, c.company, c.title, c.location, ...(tagsByContact.get(c.id) ?? []).map((t) => t.name)]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(s)),
      )
    }
    const sorted = [...l]
    if (sort === 'name') sorted.sort((a, b) => fullName(a).localeCompare(fullName(b)))
    if (sort === 'recent')
      sorted.sort((a, b) => new Date(b.last_contacted ?? 0).getTime() - new Date(a.last_contacted ?? 0).getTime())
    if (sort === 'added') sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return sorted
  }, [contacts, filter, search, sort, tagsByContact])

  const submitQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const c = await quickAdd.mutateAsync(newName)
    setNewName('')
    navigate(`/contacts/${c.id}`)
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <span className="text-sm text-slate-500">{contacts?.length ?? 0} people</span>
      </header>

      {/* Quick add — name only, enrich later */}
      <form onSubmit={submitQuickAdd} className="flex gap-2">
        <input
          className={input}
          placeholder="Quick add: type a name and hit enter…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className={btnPrimary} disabled={!newName.trim() || quickAdd.isPending}>
          <Icon name="plus" className="w-4 h-4" /> Add
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Icon name="search" className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            className={`${input} pl-9`}
            placeholder="Search name, company, tag, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={`${input} w-auto`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">A–Z</option>
          <option value="recent">Recently contacted</option>
          <option value="added">Recently added</option>
        </select>
      </div>

      <div className="flex gap-1.5">
        {(['all', 'business', 'personal', 'overdue'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`${chip} ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            {f === 'overdue' ? 'needs a ping' : f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : list.length === 0 ? (
        <div className={`${card} p-8 text-center text-slate-500 text-sm`}>
          {contacts?.length === 0 ? 'No contacts yet — add your first person above.' : 'No matches.'}
        </div>
      ) : (
        <ul className={`${card} divide-y divide-slate-800`}>
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 p-3 hover:bg-slate-800/50">
                <Avatar contact={c} src={c.photo_url ? photos?.[c.photo_url] : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-100 flex items-center gap-2">
                    {fullName(c)}
                    {kitOverdue(c) && <span className={`${chip} bg-red-500/15 text-red-400`}>ping</span>}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {[c.title, c.company].filter(Boolean).join(' @ ') || c.location || c.summary || '—'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex gap-1 justify-end mb-1">
                    {(tagsByContact.get(c.id) ?? []).slice(0, 3).map((t) => (
                      <span key={t.id} className={chip} style={{ background: `${t.color}26`, color: t.color }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600">{c.last_contacted ? ago(c.last_contacted) : 'no contact logged'}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
