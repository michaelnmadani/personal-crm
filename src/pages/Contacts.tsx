import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useAllContactTags, useContacts, useMut, usePhotoUrls } from '../lib/hooks'
import { ago, fullName, kitOverdue } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { btnPrimary, card, chip, input } from '../components/ui'

type Filter = 'all' | 'business' | 'personal' | 'overdue' | 'favorites'
type Sort = 'name' | 'recent' | 'added'
type View = 'rows' | 'tiles'
type TileSize = 'small' | 'medium' | 'large'

const TILE_SIZES: TileSize[] = ['small', 'medium', 'large']
const TILE: Record<TileSize, { grid: string; avatar: 'md' | 'lg' | 'xl'; pad: string; name: string }> = {
  small: { grid: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6', avatar: 'md', pad: 'p-3', name: 'text-sm' },
  medium: { grid: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4', avatar: 'lg', pad: 'p-4', name: 'text-base' },
  large: { grid: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', avatar: 'xl', pad: 'p-5', name: 'text-lg' },
}

export function Contacts() {
  const { data: contacts, isLoading } = useContacts()
  const { data: allTags } = useAllContactTags()
  const { data: photos } = usePhotoUrls((contacts ?? []).map((c) => c.photo_url))
  const quickAdd = useMut(api.quickAddContact)
  const setFavorite = useMut(api.setFavorite)
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [newName, setNewName] = useState('')
  const [view, setView] = useState<View>(() => (localStorage.getItem('contactsView') === 'tiles' ? 'tiles' : 'rows'))
  const [tileSize, setTileSize] = useState<TileSize>(() => {
    const s = localStorage.getItem('contactsTileSize')
    return s === 'small' || s === 'large' ? s : 'medium'
  })

  const switchView = (v: View) => {
    setView(v)
    localStorage.setItem('contactsView', v)
  }

  const switchTileSize = (s: TileSize) => {
    setTileSize(s)
    localStorage.setItem('contactsTileSize', s)
  }

  const toggleFavorite = (e: React.MouseEvent, id: string, favorite: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setFavorite.mutate({ id, favorite: !favorite })
  }

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
    if (filter === 'favorites') l = l.filter((c) => c.favorite)
    if (search.trim()) {
      const s = search.toLowerCase()
      l = l.filter((c) =>
        [fullName(c), c.nickname, c.company, c.title, c.location, ...(tagsByContact.get(c.id) ?? []).map((t) => t.name)]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(s)),
      )
    }
    const cmp =
      sort === 'recent'
        ? (a: typeof l[number], b: typeof l[number]) =>
            new Date(b.last_contacted ?? 0).getTime() - new Date(a.last_contacted ?? 0).getTime()
        : sort === 'added'
          ? (a: typeof l[number], b: typeof l[number]) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          : (a: typeof l[number], b: typeof l[number]) => fullName(a).localeCompare(fullName(b))
    // Favourites always float to the top, then the chosen sort within each group.
    return [...l].sort((a, b) => Number(b.favorite) - Number(a.favorite) || cmp(a, b))
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
        <div className="flex rounded-lg border border-slate-700 overflow-hidden">
          <button
            onClick={() => switchView('rows')}
            className={`p-2 ${view === 'rows' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            aria-label="Row view"
            title="Rows"
          >
            <Icon name="rows" className="w-4 h-4" />
          </button>
          <button
            onClick={() => switchView('tiles')}
            className={`p-2 ${view === 'tiles' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            aria-label="Tile view"
            title="Tiles"
          >
            <Icon name="grid" className="w-4 h-4" />
          </button>
        </div>
        {view === 'tiles' && (
          <div className="flex rounded-lg border border-slate-700 overflow-hidden" role="group" aria-label="Tile size">
            {TILE_SIZES.map((s) => (
              <button
                key={s}
                onClick={() => switchTileSize(s)}
                className={`px-2.5 py-2 text-xs capitalize ${
                  tileSize === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title={`${s.charAt(0).toUpperCase() + s.slice(1)} tiles`}
              >
                {s.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'favorites', 'business', 'personal', 'overdue'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`${chip} ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            {f === 'overdue' ? 'needs a ping' : f === 'favorites' ? '★ favourites' : f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : list.length === 0 ? (
        <div className={`${card} p-8 text-center text-slate-500 text-sm`}>
          {contacts?.length === 0 ? 'No contacts yet — add your first person above.' : 'No matches.'}
        </div>
      ) : view === 'tiles' ? (
        <ul className={`grid ${TILE[tileSize].grid} gap-3`}>
          {list.map((c) => (
            <li key={c.id}>
              <Link
                to={`/contacts/${c.id}`}
                className={`${card} relative flex flex-col items-center text-center ${TILE[tileSize].pad} gap-2 hover:border-slate-600 h-full`}
              >
                <button
                  onClick={(e) => toggleFavorite(e, c.id, c.favorite)}
                  className={`absolute top-2 right-2 ${c.favorite ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}`}
                  aria-label={c.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  aria-pressed={c.favorite}
                  title={c.favorite ? 'Favourited' : 'Favourite'}
                >
                  <Icon name="star" className="w-4 h-4" filled={c.favorite} />
                </button>
                <Avatar contact={c} size={TILE[tileSize].avatar} src={c.photo_url ? photos?.[c.photo_url] : undefined} />
                <p className={`font-medium text-slate-100 leading-tight ${TILE[tileSize].name}`}>
                  {fullName(c)}
                  {kitOverdue(c) && <span className={`${chip} bg-red-500/15 text-red-400 ml-1.5 align-middle`}>ping</span>}
                </p>
                {tileSize !== 'small' && (
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {[c.title, c.company].filter(Boolean).join(' @ ') || c.location || c.summary || '—'}
                  </p>
                )}
                {tileSize !== 'small' && (tagsByContact.get(c.id) ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {(tagsByContact.get(c.id) ?? []).slice(0, 3).map((t) => (
                      <span key={t.id} className={chip} style={{ background: `${t.color}26`, color: t.color }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {tileSize !== 'small' && (
                  <p className="text-[11px] text-slate-600 mt-auto">
                    {c.last_contacted ? ago(c.last_contacted) : 'no contact logged'}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={`${card} divide-y divide-slate-800`}>
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 p-3 hover:bg-slate-800/50">
                <button
                  onClick={(e) => toggleFavorite(e, c.id, c.favorite)}
                  className={`shrink-0 ${c.favorite ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}`}
                  aria-label={c.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  aria-pressed={c.favorite}
                  title={c.favorite ? 'Favourited' : 'Favourite'}
                >
                  <Icon name="star" className="w-4 h-4" filled={c.favorite} />
                </button>
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
