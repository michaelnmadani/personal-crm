import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { GroupType } from '../lib/types'
import { useAllGroupMembers, useContacts, useGroups, usePhotoUrls, useRelationships } from '../lib/hooks'
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

type Selected = { kind: 'contact'; id: string } | { kind: 'group'; id: string } | null

export function Network() {
  const { data: contacts } = useContacts()
  const { data: rels } = useRelationships()
  const { data: groups } = useGroups()
  const { data: memberships } = useAllGroupMembers()
  const { data: photos } = usePhotoUrls((contacts ?? []).map((c) => c.photo_url))
  const [params] = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [selected, setSelected] = useState<Selected>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'business' | 'personal'>('all')
  const [groupFilter, setGroupFilter] = useState(params.get('group') ?? '')

  const focusId = params.get('focus')

  const elements = useMemo(() => {
    if (!contacts) return []
    let visible = contacts
    if (kindFilter !== 'all') visible = visible.filter((c) => c.kind === kindFilter || c.kind === 'both')
    if (groupFilter) {
      const memberIds = new Set((memberships ?? []).filter((m) => m.group_id === groupFilter).map((m) => m.contact_id))
      visible = visible.filter((c) => memberIds.has(c.id))
    }
    const visibleIds = new Set(visible.map((c) => c.id))

    const els: cytoscape.ElementDefinition[] = visible.map((c) => ({
      data: {
        id: c.id,
        label: fullName(c),
        kind: c.kind,
        ...(c.photo_url && photos?.[c.photo_url] ? { photo: photos[c.photo_url] } : {}),
      },
    }))

    const visibleGroups = (groups ?? []).filter((g) => {
      if (groupFilter) return g.id === groupFilter
      return (memberships ?? []).some((m) => m.group_id === g.id && visibleIds.has(m.contact_id))
    })
    for (const g of visibleGroups) {
      els.push({ data: { id: `g-${g.id}`, label: g.name, gtype: g.type, gcolor: GROUP_COLORS[g.type] } })
    }
    const groupIds = new Set(visibleGroups.map((g) => g.id))

    for (const r of rels ?? []) {
      if (visibleIds.has(r.from_contact) && visibleIds.has(r.to_contact)) {
        els.push({
          data: { id: `r-${r.id}`, source: r.from_contact, target: r.to_contact, rel: r.relation, w: r.strength },
        })
      }
    }
    for (const m of memberships ?? []) {
      if (visibleIds.has(m.contact_id) && groupIds.has(m.group_id)) {
        els.push({
          data: { id: `m-${m.group_id}-${m.contact_id}`, source: m.contact_id, target: `g-${m.group_id}`, membership: 1 },
        })
      }
    }
    return els
  }, [contacts, rels, groups, memberships, photos, kindFilter, groupFilter])

  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 9,
            color: '#94a3b8',
            'text-valign': 'bottom',
            'text-margin-y': 5,
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
          selector: 'node[gtype]',
          style: {
            shape: 'round-rectangle',
            width: 'label',
            height: 22,
            'padding-left': '8px',
            'padding-right': '8px',
            'background-color': 'data(gcolor)',
            'background-opacity': 0.25,
            'border-color': 'data(gcolor)',
            'border-width': 1.5,
            color: '#e2e8f0',
            'font-size': 10,
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-margin-y': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(w, 1, 5, 1, 4)',
            'line-color': '#475569',
            'curve-style': 'bezier',
            opacity: 0.8,
          },
        },
        {
          selector: 'edge[membership]',
          style: { width: 1, 'line-style': 'dashed', 'line-color': '#334155', opacity: 0.6 },
        },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f8fafc' } },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 70,
        padding: 30,
      } as cytoscape.LayoutOptions,
    })

    cy.on('tap', 'node', (evt) => {
      const id: string = evt.target.id()
      setSelected(id.startsWith('g-') ? { kind: 'group', id: id.slice(2) } : { kind: 'contact', id })
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    if (focusId && cy.getElementById(focusId).length > 0) {
      const node = cy.getElementById(focusId)
      node.select()
      cy.animate({ center: { eles: node }, zoom: 1.4, duration: 400 })
      setSelected({ kind: 'contact', id: focusId })
    }

    cyRef.current = cy
    return () => {
      cyRef.current = null
      cy.destroy()
    }
  }, [elements, focusId])

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const cy = cyRef.current
    if (!cy || !search.trim()) return
    const s = search.trim().toLowerCase()
    const match = cy.nodes().filter((n) => String(n.data('label')).toLowerCase().includes(s))
    if (match.length > 0) {
      cy.nodes().unselect()
      match.first().select()
      cy.animate({ center: { eles: match.first() }, zoom: 1.4, duration: 400 })
      const id = match.first().id()
      setSelected(id.startsWith('g-') ? { kind: 'group', id: id.slice(2) } : { kind: 'contact', id })
    }
  }

  const selectedContact = selected?.kind === 'contact' ? (contacts ?? []).find((c) => c.id === selected.id) : null
  const selectedGroup = selected?.kind === 'group' ? (groups ?? []).find((g) => g.id === selected.id) : null
  const hasAnything = (contacts ?? []).length > 0

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
            placeholder="Find someone and press enter…"
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
        <select className={`${input} w-auto`} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`${card} relative overflow-hidden`} style={{ height: 'calc(100vh - 230px)', minHeight: 360 }}>
        {!hasAnything && (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-500 z-10">
            Add some contacts first — they'll appear here as your network.
          </p>
        )}
        <div ref={containerRef} className="absolute inset-0" />

        {(selectedContact || selectedGroup) && (
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
                  <Link to={`/contacts/${selectedContact.id}`} className="text-xs text-indigo-400 hover:underline">
                    Open profile →
                  </Link>
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
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Drag to pan · pinch/scroll to zoom · tap a person or group to inspect. Solid lines are direct connections
        (thicker = stronger); dashed lines are group memberships. Add connections from a contact's profile.
      </p>
    </div>
  )
}
