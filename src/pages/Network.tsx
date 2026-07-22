import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { GroupType } from '../lib/types'
import {
  useAllGroupMembers,
  useAllWorkHistory,
  useContacts,
  useGroups,
  usePhotoUrls,
  useRelationships,
} from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { btnGhost, card, chip, input } from '../components/ui'

const GROUP_COLORS: Record<GroupType, string> = {
  company: '#6366f1',
  church: '#8b5cf6',
  sports: '#10b981',
  school: '#f59e0b',
  club: '#ec4899',
  nonprofit: '#14b8a6',
  family: '#f43f5e',
  other: '#64748b',
}

// A 1000-node force layout is unusable; cap what we draw at once and let the
// user drill in by searching a person or clicking a company.
const MAX_PEOPLE = 220

type Selected = { kind: 'contact'; id: string } | { kind: 'group'; id: string } | { kind: 'company'; key: string } | null

/** Normalize a company name so "Acme Corp." and "acme corp" match. */
const normCompany = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(inc|llc|ltd|corp|co|gmbh|plc|group|pty|limited)$/, '')
    .trim()

export function Network() {
  const { data: contacts } = useContacts()
  const { data: rels } = useRelationships()
  const { data: groups } = useGroups()
  const { data: memberships } = useAllGroupMembers()
  const { data: allWork } = useAllWorkHistory()
  const { data: photos } = usePhotoUrls((contacts ?? []).map((c) => c.photo_url))
  const [params] = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [selected, setSelected] = useState<Selected>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'business' | 'personal'>('all')
  const [groupFilter, setGroupFilter] = useState(params.get('group') ?? '')
  const [focusPerson, setFocusPerson] = useState<string | null>(params.get('focus'))
  const [focusCompany, setFocusCompany] = useState<string | null>(null)

  const byId = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, c])), [contacts])

  // company key -> { display name, member ids }, from current company + work history.
  const companyIndex = useMemo(() => {
    const m = new Map<string, { display: string; ids: Set<string> }>()
    const add = (company: string | null, id: string) => {
      if (!company) return
      const key = normCompany(company)
      if (!key) return
      const e = m.get(key) ?? { display: company.trim(), ids: new Set<string>() }
      e.ids.add(id)
      m.set(key, e)
    }
    for (const c of contacts ?? []) add(c.company, c.id)
    for (const w of allWork ?? []) add(w.company, w.contact_id)
    return m
  }, [contacts, allWork])

  const companiesOf = useMemo(() => {
    const m = new Map<string, string[]>() // contactId -> [company keys]
    for (const [key, v] of companyIndex) for (const id of v.ids) m.set(id, [...(m.get(id) ?? []), key])
    return m
  }, [companyIndex])

  // Companies with 2+ people, largest first — for the picker.
  const companyOptions = useMemo(
    () =>
      [...companyIndex.entries()]
        .map(([key, v]) => ({ key, display: v.display, count: v.ids.size }))
        .filter((c) => c.count >= 2)
        .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display)),
    [companyIndex],
  )

  const { elements, shown, total, note } = useMemo(() => {
    if (!contacts) return { elements: [] as cytoscape.ElementDefinition[], shown: 0, total: 0, note: '' }

    // Pool = contacts allowed by the kind filter.
    let pool = contacts
    if (kindFilter !== 'all') pool = pool.filter((c) => c.kind === kindFilter || c.kind === 'both')
    const poolIds = new Set(pool.map((c) => c.id))

    // Which people are members of a given company, within the pool.
    const companyMembers = (key: string) => [...(companyIndex.get(key)?.ids ?? [])].filter((id) => poolIds.has(id))

    let peopleIds = new Set<string>()
    const hubKeys = new Set<string>()
    let showGroupIds = new Set<string>()
    let note = ''

    if (groupFilter) {
      // Everyone in the chosen group.
      const ids = (memberships ?? []).filter((m) => m.group_id === groupFilter).map((m) => m.contact_id)
      peopleIds = new Set(ids.filter((id) => poolIds.has(id)))
      showGroupIds = new Set([groupFilter])
    } else if (focusCompany) {
      // Everyone at the focused company.
      const members = companyMembers(focusCompany)
      peopleIds = new Set(members.slice(0, MAX_PEOPLE))
      hubKeys.add(focusCompany)
      if (members.length > peopleIds.size) note = `Showing ${peopleIds.size} of ${members.length} at this company.`
    } else if (focusPerson && poolIds.has(focusPerson)) {
      // Ego network: the person, their colleagues, group-mates and connections.
      peopleIds.add(focusPerson)
      for (const key of companiesOf.get(focusPerson) ?? []) {
        hubKeys.add(key)
        for (const id of companyMembers(key)) peopleIds.add(id)
      }
      const myGroups = (memberships ?? []).filter((m) => m.contact_id === focusPerson).map((m) => m.group_id)
      showGroupIds = new Set(myGroups)
      for (const m of memberships ?? [])
        if (myGroups.includes(m.group_id) && poolIds.has(m.contact_id)) peopleIds.add(m.contact_id)
      for (const r of rels ?? []) {
        if (r.from_contact === focusPerson && poolIds.has(r.to_contact)) peopleIds.add(r.to_contact)
        if (r.to_contact === focusPerson && poolIds.has(r.from_contact)) peopleIds.add(r.from_contact)
      }
      if (peopleIds.size > MAX_PEOPLE + 1) {
        const trimmed = new Set([focusPerson, ...[...peopleIds].filter((id) => id !== focusPerson).slice(0, MAX_PEOPLE)])
        note = `Showing ${trimmed.size} of ${peopleIds.size} connections — click a company to see more.`
        peopleIds = trimmed
      }
    } else {
      // Default overview: biggest company clusters, capped for a fast first paint.
      const ranked = [...companyIndex.entries()]
        .map(([key, v]) => ({ key, members: [...v.ids].filter((id) => poolIds.has(id)) }))
        .filter((x) => x.members.length >= 2)
        .sort((a, b) => b.members.length - a.members.length)
      let budget = MAX_PEOPLE
      let clusters = 0
      for (const { key, members } of ranked) {
        if (budget <= 0) break
        hubKeys.add(key)
        clusters++
        for (const id of members.slice(0, budget)) peopleIds.add(id)
        budget -= members.length
      }
      const totalClusters = ranked.length
      note =
        totalClusters > clusters
          ? `Your ${clusters} biggest company clusters. Search a name or click a company to explore the rest.`
          : 'Search a name or click a company to explore.'
    }

    // ---- build cytoscape elements -----------------------------------------
    const els: cytoscape.ElementDefinition[] = []
    for (const id of peopleIds) {
      const c = byId.get(id)
      if (!c) continue
      els.push({
        data: {
          id: c.id,
          label: fullName(c),
          kind: c.kind,
          ...(c.photo_url && photos?.[c.photo_url] ? { photo: photos[c.photo_url] } : {}),
        },
      })
    }

    // Company hub nodes + spokes.
    for (const key of hubKeys) {
      const info = companyIndex.get(key)
      if (!info) continue
      const members = [...info.ids].filter((id) => peopleIds.has(id))
      if (members.length < 2 && !focusCompany) continue
      els.push({ data: { id: `co-${key}`, label: info.display, company: 1 } })
      for (const id of members) els.push({ data: { id: `h-${key}-${id}`, source: id, target: `co-${key}`, hub: 1 } })
    }

    // Group nodes + memberships.
    for (const g of (groups ?? []).filter((g) => showGroupIds.has(g.id))) {
      const members = (memberships ?? []).filter((m) => m.group_id === g.id && peopleIds.has(m.contact_id))
      if (members.length === 0) continue
      els.push({ data: { id: `g-${g.id}`, label: g.name, gtype: g.type, gcolor: GROUP_COLORS[g.type] } })
      for (const m of members)
        els.push({ data: { id: `m-${g.id}-${m.contact_id}`, source: m.contact_id, target: `g-${g.id}`, membership: 1 } })
    }

    // Explicit relationships between shown people.
    for (const r of rels ?? [])
      if (peopleIds.has(r.from_contact) && peopleIds.has(r.to_contact))
        els.push({ data: { id: `r-${r.id}`, source: r.from_contact, target: r.to_contact, rel: r.relation, w: r.strength } })

    return { elements: els, shown: peopleIds.size, total: poolIds.size, note }
  }, [contacts, rels, groups, memberships, photos, kindFilter, groupFilter, focusPerson, focusCompany, companyIndex, companiesOf, byId])

  useEffect(() => {
    if (!containerRef.current) return
    // Theme-aware label colour so text is readable in light and dark themes.
    const cssVar = (name: string, fallback: string) =>
      getComputedStyle(containerRef.current!).getPropertyValue(name).trim() || fallback
    const labelColor = cssVar('--color-slate-400', '#94a3b8')

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 9,
            color: labelColor,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-max-width': '90px',
            'text-wrap': 'ellipsis',
            width: 30,
            height: 30,
            'background-color': '#6366f1',
            'border-width': 1.5,
            'border-color': '#312e81',
          },
        },
        { selector: 'node[kind="personal"]', style: { 'background-color': '#ec4899', 'border-color': '#831843' } },
        { selector: 'node[kind="both"]', style: { 'background-color': '#8b5cf6', 'border-color': '#4c1d95' } },
        {
          selector: 'node[photo]',
          style: { 'background-image': 'data(photo)', 'background-fit': 'cover', 'background-color': '#1e293b' },
        },
        {
          selector: 'node[company]',
          style: {
            shape: 'round-rectangle',
            width: 'label',
            height: 26,
            'padding-left': '10px',
            'padding-right': '10px',
            'background-color': '#0ea5e9',
            'background-opacity': 0.2,
            'border-color': '#0ea5e9',
            'border-width': 2,
            color: '#0ea5e9',
            'font-size': 11,
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-margin-y': 0,
          },
        },
        {
          selector: 'node[gtype]',
          style: {
            shape: 'round-rectangle',
            width: 'label',
            height: 22,
            'padding-left': '8px',
            'padding-right': '8px',
            'background-color': 'data(gcolor)',
            'background-opacity': 0.2,
            'border-color': 'data(gcolor)',
            'border-width': 1.5,
            color: 'data(gcolor)',
            'font-size': 10,
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-margin-y': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(w, 1, 5, 1.5, 4)',
            'line-color': '#64748b',
            'curve-style': 'bezier',
            opacity: 0.7,
          },
        },
        { selector: 'edge[hub]', style: { width: 1, 'line-color': '#0ea5e9', opacity: 0.35 } },
        { selector: 'edge[membership]', style: { width: 1, 'line-style': 'dashed', 'line-color': '#94a3b8', opacity: 0.5 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f59e0b' } },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 80,
        padding: 40,
        randomize: true,
      } as cytoscape.LayoutOptions,
    })

    cy.on('tap', 'node', (evt) => {
      const id: string = evt.target.id()
      if (id.startsWith('co-')) setSelected({ kind: 'company', key: id.slice(3) })
      else if (id.startsWith('g-')) setSelected({ kind: 'group', id: id.slice(2) })
      else setSelected({ kind: 'contact', id })
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    if (focusPerson && cy.getElementById(focusPerson).length > 0) {
      const node = cy.getElementById(focusPerson)
      node.select()
      cy.animate({ center: { eles: node }, zoom: 1.3, duration: 400 })
    }

    cyRef.current = cy
    return () => {
      cyRef.current = null
      cy.destroy()
    }
  }, [elements, focusPerson])

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const s = search.trim().toLowerCase()
    if (!s) return
    const match = (contacts ?? []).find((c) => fullName(c).toLowerCase().includes(s))
    if (match) {
      setFocusCompany(null)
      setFocusPerson(match.id)
      setSelected({ kind: 'contact', id: match.id })
    }
  }

  const focusOnCompany = (key: string) => {
    setFocusPerson(null)
    setFocusCompany(key)
    setSelected(null)
  }
  const clearFocus = () => {
    setFocusPerson(null)
    setFocusCompany(null)
    setSelected(null)
  }

  const selectedContact = selected?.kind === 'contact' ? byId.get(selected.id) : null
  const selectedGroup = selected?.kind === 'group' ? (groups ?? []).find((g) => g.id === selected.id) : null
  const selectedCompany = selected?.kind === 'company' ? companyIndex.get(selected.key) : null
  const hasAnything = (contacts ?? []).length > 0

  const focusLabel = focusPerson
    ? (byId.get(focusPerson) && fullName(byId.get(focusPerson)!)) || 'person'
    : focusCompany
      ? companyIndex.get(focusCompany)?.display ?? 'company'
      : null

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Network</h1>
        <Link to="/groups" className={btnGhost}>
          Manage groups
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={doSearch} className="relative flex-1 min-w-40">
          <Icon name="search" className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            className={`${input} pl-9`}
            placeholder="Find someone and press enter to see their network…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <div className="flex gap-1.5">
          {(['all', 'business', 'personal'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`${chip} ${kindFilter === k ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              {k}
            </button>
          ))}
        </div>
        <select
          className={`${input} w-auto`}
          value={focusCompany ?? ''}
          onChange={(e) => (e.target.value ? focusOnCompany(e.target.value) : clearFocus())}
        >
          <option value="">All companies</option>
          {companyOptions.map((c) => (
            <option key={c.key} value={c.key}>
              {c.display} ({c.count})
            </option>
          ))}
        </select>
        <select className={`${input} w-auto`} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {(focusLabel || note) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {focusLabel && (
            <button onClick={clearFocus} className={`${chip} bg-indigo-600/20 text-indigo-300 inline-flex items-center gap-1`}>
              Focused on {focusLabel}
              <Icon name="x" className="w-3 h-3" />
            </button>
          )}
          {note && <span>{note}</span>}
          {!focusLabel && shown < total && <span>· {shown} of {total} people shown</span>}
        </div>
      )}

      <div className={`${card} relative overflow-hidden`} style={{ height: 'calc(100vh - 250px)', minHeight: 360 }}>
        {!hasAnything && (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-500 z-10">
            Add some contacts first — they'll appear here as your network.
          </p>
        )}
        {hasAnything && elements.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-500 z-10 px-6 text-center">
            No connections to draw for this filter yet. Try “all”, clear the group filter, or add company/work history to
            your contacts.
          </p>
        )}
        <div ref={containerRef} className="absolute inset-0" />

        {(selectedContact || selectedGroup || selectedCompany) && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-72 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-10">
            <button
              className="absolute top-2 right-2 text-slate-500 hover:text-slate-300"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
            {selectedContact && (
              <div className="flex items-center gap-3">
                <Avatar
                  contact={selectedContact}
                  src={selectedContact.photo_url ? photos?.[selectedContact.photo_url] : undefined}
                />
                <div className="min-w-0">
                  <p className="font-medium text-slate-100 truncate">{fullName(selectedContact)}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {[selectedContact.title, selectedContact.company].filter(Boolean).join(' @ ') || selectedContact.kind}
                  </p>
                  <div className="flex gap-3 mt-0.5">
                    {focusPerson !== selectedContact.id && (
                      <button
                        onClick={() => {
                          setFocusCompany(null)
                          setFocusPerson(selectedContact.id)
                        }}
                        className="text-xs text-indigo-400 hover:underline"
                      >
                        See network
                      </button>
                    )}
                    <Link to={`/contacts/${selectedContact.id}`} className="text-xs text-indigo-400 hover:underline">
                      Open profile →
                    </Link>
                  </div>
                </div>
              </div>
            )}
            {selectedGroup && (
              <div>
                <p className="font-medium text-slate-100">{selectedGroup.name}</p>
                <p className="text-xs text-slate-500 capitalize">{selectedGroup.type}</p>
                <Link to={`/groups/${selectedGroup.id}`} className="text-xs text-indigo-400 hover:underline">
                  View members →
                </Link>
              </div>
            )}
            {selectedCompany && selected?.kind === 'company' && (
              <div>
                <p className="font-medium text-slate-100">{selectedCompany.display}</p>
                <p className="text-xs text-slate-500">{selectedCompany.ids.size} people</p>
                <button onClick={() => focusOnCompany(selected.key)} className="text-xs text-indigo-400 hover:underline">
                  Show everyone here →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Search a name to see just their network, or click a <span className="text-sky-500">company</span> hub to explore
        everyone there. Drag to pan · scroll to zoom. Blue hubs group people by shared employer; dashed lines are group
        memberships; solid lines are direct connections you've added (thicker = stronger).
      </p>
    </div>
  )
}
