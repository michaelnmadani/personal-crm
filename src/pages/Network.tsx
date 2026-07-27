import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { ContactOverview, GroupType } from '../lib/types'
import {
  api,
  useAllGroupMembers,
  useAllWorkHistory,
  useContacts,
  useGroups,
  useMut,
  usePhotoUrls,
  useRelationships,
} from '../lib/hooks'
import { fullName } from '../lib/utils'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { btnGhost, btnPrimary, card, chip, input } from '../components/ui'

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

// Layout geometry. SLOT is the horizontal room one node's label needs, so
// spacing is driven by label width rather than circle width — that's what stops
// names from colliding.
const SLOT = 132
const RING_0 = 165
const RING_STEP = 104
const CLUSTER_GAP = 90
const EDGE_TYPES = ['knows', 'friend', 'family', 'colleague', 'introduced me', 'client', 'mentor']

type Pos = { x: number; y: number }

/**
 * Wrap a hub name onto multiple lines and return the pill size that fits it.
 * Cytoscape's `width: 'label'` auto-sizing is deprecated (it resolves to zero),
 * so the pill is measured here and fed back through data() mappers.
 */
function hubLabel(name: string, fontPx: number, maxChars = 18) {
  const lines: string[] = []
  let cur = ''
  for (const word of name.trim().split(/\s+/)) {
    if (!cur) cur = word
    else if (`${cur} ${word}`.length <= maxChars) cur += ` ${word}`
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  // Hard-break any single word that still overflows (e.g. a long domain).
  const wrapped: string[] = []
  for (const line of lines) {
    if (line.length <= maxChars) wrapped.push(line)
    else for (let i = 0; i < line.length; i += maxChars) wrapped.push(line.slice(i, i + maxChars))
  }
  const widest = Math.max(...wrapped.map((l) => l.length))
  return {
    text: wrapped.join('\n'),
    w: Math.round(Math.max(112, widest * fontPx * 0.62 + 26)),
    h: Math.round(Math.max(36, wrapped.length * (fontPx + 5) + 18)),
  }
}

/** Do segments ab and cd properly cross? Shared endpoints don't count. */
function segmentsCross(a: Pos, b: Pos, c: Pos, d: Pos) {
  const side = (p: Pos, q: Pos, r: Pos) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const d1 = side(a, b, c)
  const d2 = side(a, b, d)
  const d3 = side(c, d, a)
  const d4 = side(c, d, b)
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4
}

export function countCrossings(edges: [string, string][], pos: Record<string, Pos>) {
  let n = 0
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i]
      const [c, d] = edges[j]
      if (a === c || a === d || b === c || b === d) continue
      if (pos[a] && pos[b] && pos[c] && pos[d] && segmentsCross(pos[a], pos[b], pos[c], pos[d])) n++
    }
  return n
}

/**
 * Swap nodes between their allotted slots while that reduces the number of
 * crossing connection lines. Slots are fixed, so spacing (and therefore label
 * legibility) is untouched — only which person sits where changes. Zero
 * crossings isn't always reachable (a non-planar graph cannot be drawn without
 * them), so this is best-effort local search with a work cap.
 */
function reduceCrossings(
  positions: Record<string, Pos>,
  edges: [string, string][],
  groups: string[][],
  maxPasses = 8,
) {
  if (edges.length < 2) return
  const touched = new Set(edges.flat())
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (const group of groups) {
      // Only bother moving people who actually have connections drawn.
      const movable = group.filter((id) => touched.has(id))
      if (movable.length < 2) continue
      for (let i = 0; i < movable.length; i++) {
        for (let j = i + 1; j < movable.length; j++) {
          const a = movable[i]
          const b = movable[j]
          const before = countCrossings(edges, positions)
          if (before === 0) return
          const tmp = positions[a]
          positions[a] = positions[b]
          positions[b] = tmp
          if (countCrossings(edges, positions) < before) improved = true
          else {
            const back = positions[a]
            positions[a] = positions[b]
            positions[b] = back
          }
        }
      }
    }
    if (!improved) return
  }
}

/**
 * Deterministic hub-and-spoke layout: each company/group hub gets its members
 * on concentric rings sized so every node owns a SLOT-wide arc, then clusters
 * are packed into rows. A force layout (cose) pulls tightly-connected nodes
 * into a blob where labels overlap badly; this trades organic look for
 * guaranteed legibility, and being deterministic it doesn't reshuffle on every
 * render.
 */
function computePositions(els: cytoscape.ElementDefinition[]): Record<string, Pos> {
  type D = { id: string; source?: string; target?: string; company?: number; gtype?: string; hub?: number; membership?: number }
  const data = (e: cytoscape.ElementDefinition) => e.data as unknown as D

  const nodes = els.filter((e) => !data(e).source)
  const hubIds = nodes.filter((e) => data(e).company || data(e).gtype).map((e) => data(e).id)
  const peopleIds = nodes.filter((e) => !data(e).company && !data(e).gtype).map((e) => data(e).id)

  // Attach each person to the first hub that claims them.
  const membersOf = new Map<string, string[]>(hubIds.map((h) => [h, []]))
  const claimed = new Set<string>()
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target) continue
    if (!d.hub && !d.membership) continue
    if (claimed.has(d.source) || !membersOf.has(d.target)) continue
    membersOf.get(d.target)!.push(d.source)
    claimed.add(d.source)
  }

  // Adjacency from the connections you've drawn (relationship edges — not the
  // hub spokes or group memberships).
  const adj = new Map<string, string[]>()
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || d.hub || d.membership) continue
    adj.set(d.source, [...(adj.get(d.source) ?? []), d.target])
    adj.set(d.target, [...(adj.get(d.target) ?? []), d.source])
  }

  /**
   * Order a cluster's members so connected people come out consecutively.
   * Ring slots are filled in array order, so consecutive members land side by
   * side — which keeps a relationship edge as a short hop between neighbours
   * instead of a chord across the whole cluster.
   */
  const orderMembers = (members: string[]) => {
    if (adj.size === 0) return members
    const inCluster = new Set(members)
    const degree = (id: string) => (adj.get(id) ?? []).filter((n) => inCluster.has(n)).length
    const seen = new Set<string>()
    const out: string[] = []
    // Most-connected first, so dense pockets stay contiguous.
    for (const start of [...members].sort((a, b) => degree(b) - degree(a))) {
      if (seen.has(start)) continue
      seen.add(start)
      const queue = [start]
      while (queue.length > 0) {
        const cur = queue.shift()!
        out.push(cur)
        for (const nb of adj.get(cur) ?? []) {
          if (inCluster.has(nb) && !seen.has(nb)) {
            seen.add(nb)
            queue.push(nb)
          }
        }
      }
    }
    return out
  }

  // Ring plan for n members: fill outward, each ring holding as many nodes as
  // fit at SLOT spacing around its circumference.
  const ringsFor = (n: number) => {
    const rings: { r: number; count: number }[] = []
    let left = n
    let r = RING_0
    while (left > 0) {
      const cap = Math.max(6, Math.floor((2 * Math.PI * r) / SLOT))
      const take = Math.min(cap, left)
      rings.push({ r, count: take })
      left -= take
      r += RING_STEP
    }
    return rings
  }

  const clusters = hubIds
    .map((id) => {
      const members = orderMembers(membersOf.get(id) ?? [])
      const rings = ringsFor(members.length)
      const radius = members.length === 0 ? RING_0 / 2 : rings[rings.length - 1].r + RING_STEP / 2
      return { id, members, rings, radius }
    })
    .sort((a, b) => b.radius - a.radius)

  // Pack clusters into rows, keeping the whole thing roughly square.
  const positions: Record<string, Pos> = {}
  // Aim for a roughly square overall footprint: sqrt of the summed cluster
  // areas, nudged wider so a big cluster doesn't force one-per-row.
  const areaSum = clusters.reduce((s, c) => s + (2 * c.radius + CLUSTER_GAP) ** 2, 0)
  const targetW = Math.max(2 * (clusters[0]?.radius ?? 200) + CLUSTER_GAP, Math.sqrt(areaSum) * 1.3)
  let x = 0
  let y = 0
  let rowH = 0
  for (const c of clusters) {
    const d = 2 * c.radius + CLUSTER_GAP
    if (x > 0 && x + d > targetW) {
      x = 0
      y += rowH
      rowH = 0
    }
    const cx = x + c.radius + CLUSTER_GAP / 2
    const cy = y + c.radius + CLUSTER_GAP / 2
    positions[c.id] = { x: cx, y: cy }
    let i = 0
    for (const [ri, ring] of c.rings.entries()) {
      const step = (2 * Math.PI) / ring.count
      // Half-step offset on alternate rings so labels don't line up radially.
      const phase = ri % 2 ? step / 2 : 0
      for (let k = 0; k < ring.count; k++, i++) {
        const a = k * step + phase - Math.PI / 2
        positions[c.members[i]] = { x: cx + ring.r * Math.cos(a), y: cy + ring.r * Math.sin(a) }
      }
    }
    x += d
    rowH = Math.max(rowH, d)
  }

  // Anyone with no hub (no shared employer) goes in a tidy grid underneath.
  const slotGroups: string[][] = clusters.map((c) => c.members)
  const loose = orderMembers(peopleIds.filter((id) => !claimed.has(id)))
  slotGroups.push(loose)
  if (loose.length > 0) {
    const perRow = Math.max(1, Math.floor(targetW / SLOT))
    const top = y + rowH + CLUSTER_GAP
    loose.forEach((id, i) => {
      positions[id] = { x: (i % perRow) * SLOT, y: top + Math.floor(i / perRow) * (RING_STEP * 0.8) }
    })
  }

  // Finally, untangle the connection lines by swapping people between slots.
  // Capped so a huge graph can't make this expensive.
  const relEdges: [string, string][] = []
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || d.hub || d.membership) continue
    relEdges.push([d.source, d.target])
  }
  if (relEdges.length >= 2 && relEdges.length <= 120) reduceCrossings(positions, relEdges, slotGroups)

  return positions
}

type Selected = { kind: 'contact'; id: string } | { kind: 'group'; id: string } | { kind: 'company'; key: string } | null

/** Confirm step after dragging one person onto another on the chart. */
function ConnectModal({
  from,
  to,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  from?: ContactOverview
  to?: ContactOverview
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (relation: string, strength: number) => void
}) {
  const [relation, setRelation] = useState('knows')
  const [strength, setStrength] = useState('3')
  if (!from || !to) return null

  return (
    <Modal title="Connect these two?" onClose={onCancel}>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-3">
          <div className="text-center">
            <Avatar contact={from} size="lg" />
            <p className="text-sm text-slate-200 mt-1">{fullName(from)}</p>
          </div>
          <Icon name="link" className="w-5 h-5 text-slate-500 shrink-0" />
          <div className="text-center">
            <Avatar contact={to} size="lg" />
            <p className="text-sm text-slate-200 mt-1">{fullName(to)}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 text-center">
          The connection is mutual — it appears on both contact cards, and once on the chart.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">
            Relationship
            <select className={input} value={relation} onChange={(e) => setRelation(e.target.value)}>
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Strength
            <select className={input} value={strength} onChange={(e) => setStrength(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {'●'.repeat(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={() => onConfirm(relation, Number(strength))} disabled={pending}>
            {pending ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

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
  // Drag one person onto another to propose a connection.
  const [pendingLink, setPendingLink] = useState<{ from: string; to: string } | null>(null)
  // Redraw when the theme changes so the canvas picks up the new palette — the
  // graph is drawn once to a canvas, so CSS alone can't restyle it.
  const [themeTick, setThemeTick] = useState(0)
  const addLink = useMut(api.addRelationship)

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

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
      const hl = hubLabel(info.display, 13)
      els.push({ data: { id: `co-${key}`, label: hl.text, company: 1, hw: hl.w, hh: hl.h } })
      for (const id of members) els.push({ data: { id: `h-${key}-${id}`, source: id, target: `co-${key}`, hub: 1 } })
    }

    // Group nodes + memberships.
    for (const g of (groups ?? []).filter((g) => showGroupIds.has(g.id))) {
      const members = (memberships ?? []).filter((m) => m.group_id === g.id && peopleIds.has(m.contact_id))
      if (members.length === 0) continue
      const gl = hubLabel(g.name, 11)
      els.push({ data: { id: `g-${g.id}`, label: gl.text, gtype: g.type, gcolor: GROUP_COLORS[g.type], hw: gl.w, hh: gl.h } })
      for (const m of members)
        els.push({ data: { id: `m-${g.id}-${m.contact_id}`, source: m.contact_id, target: `g-${g.id}`, membership: 1 } })
    }

    // Explicit relationships between shown people. A connection is mutual, so
    // draw one line per pair even if both directions somehow exist.
    const drawnPairs = new Set<string>()
    for (const r of rels ?? []) {
      if (!peopleIds.has(r.from_contact) || !peopleIds.has(r.to_contact)) continue
      const pair =
        r.from_contact < r.to_contact ? `${r.from_contact}|${r.to_contact}` : `${r.to_contact}|${r.from_contact}`
      if (drawnPairs.has(pair)) continue
      drawnPairs.add(pair)
      els.push({ data: { id: `r-${r.id}`, source: r.from_contact, target: r.to_contact, rel: r.relation, w: r.strength } })
    }

    return { elements: els, shown: peopleIds.size, total: poolIds.size, note }
  }, [contacts, rels, groups, memberships, photos, kindFilter, groupFilter, focusPerson, focusCompany, companyIndex, companiesOf, byId])

  useEffect(() => {
    if (!containerRef.current) return
    // The graph palette lives in CSS as plain hex per theme (cytoscape's colour
    // parser can't read Tailwind's oklch values), so names stay readable against
    // whichever card background the current theme paints behind the canvas.
    const css = getComputedStyle(containerRef.current)
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const labelColor = v('--graph-label', '#cbd5e1')
    const nodeColor = v('--graph-node', '#6366f1')
    const nodePersonal = v('--graph-node-personal', '#ec4899')
    const nodeBoth = v('--graph-node-both', '#8b5cf6')
    const hubColor = v('--graph-hub', '#0ea5e9')
    const edgeColor = v('--graph-edge', '#64748b')
    const positions = computePositions(elements)

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
            // Keep labels inside their SLOT so neighbours can't collide.
            'text-max-width': '112px',
            'text-wrap': 'ellipsis',
            width: 30,
            height: 30,
            'background-color': nodeColor,
            'border-width': 1.5,
            'border-color': nodeColor,
          },
        },
        { selector: 'node[kind="personal"]', style: { 'background-color': nodePersonal, 'border-color': nodePersonal } },
        { selector: 'node[kind="both"]', style: { 'background-color': nodeBoth, 'border-color': nodeBoth } },
        {
          selector: 'node[photo]',
          style: { 'background-image': 'data(photo)', 'background-fit': 'cover', 'background-color': '#1e293b' },
        },
        {
          selector: 'node[company]',
          style: {
            shape: 'round-rectangle',
            // Size measured from the wrapped label — `width: 'label'` is
            // deprecated and resolves to zero, which rendered hubs invisible.
            width: 'data(hw)',
            height: 'data(hh)',
            'text-wrap': 'wrap',
            'text-max-width': 'data(hw)',
            'background-color': hubColor,
            'background-opacity': 0.2,
            'border-color': hubColor,
            'border-width': 3,
            color: labelColor,
            'font-size': 14,
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-margin-y': 0,
          },
        },
        {
          selector: 'node[gtype]',
          style: {
            shape: 'round-rectangle',
            width: 'data(hw)',
            height: 'data(hh)',
            'text-wrap': 'wrap',
            'text-max-width': 'data(hw)',
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
            'line-color': edgeColor,
            // Slight curvature so lines that would run along the same path stay
            // individually visible instead of merging into one stroke.
            'curve-style': 'unbundled-bezier',
            'control-point-distances': '22',
            'control-point-weights': '0.5',
            opacity: 0.75,
          },
        },
        { selector: 'edge[hub]', style: { width: 2, 'line-color': hubColor, opacity: 0.5 } },
        { selector: 'edge[membership]', style: { width: 1, 'line-style': 'dashed', 'line-color': edgeColor, opacity: 0.45 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f59e0b' } },
        // The person you've focused is drawn at double size so they stand out
        // as the centre of the view.
        {
          selector: 'node.focused',
          style: {
            width: 60,
            height: 60,
            'font-size': 12,
            'font-weight': 'bold',
            'border-width': 4,
            'border-color': '#f59e0b',
            'z-index': 20,
          },
        },
        // Highlighted while another person is dragged over it.
        { selector: 'node.drop-target', style: { 'border-width': 5, 'border-color': '#22c55e', 'z-index': 30 } },
        // Zoomed far out, 200+ names become an illegible smear; drop them and
        // keep only the hub labels until the user zooms in.
        { selector: 'node.nolabel', style: { label: '' } },
      ],
      layout: {
        name: 'preset',
        positions: (node: cytoscape.NodeSingular) => positions[node.id()] ?? { x: 0, y: 0 },
        fit: false,
        padding: 50,
      } as cytoscape.LayoutOptions,
    })

    // The layout guarantees no label collisions at 1:1, so overlap can only
    // come from fitting a large graph into a small viewport. Rather than shrink
    // to illegibility, hold a readable zoom and let the user pan.
    const LEGIBLE_ZOOM = 0.55
    cy.fit(undefined, 50)
    if (cy.zoom() < LEGIBLE_ZOOM) {
      cy.zoom(LEGIBLE_ZOOM)
      // Land on the biggest hub so the star structure is visible, rather than
      // in the middle of a ring with no hub in frame.
      const hub = cy.nodes('[company]').first()
      cy.center(hub.nonempty() ? hub : undefined)
    }
    const syncLabels = () => {
      const show = cy.zoom() >= LEGIBLE_ZOOM * 0.9
      cy.batch(() => cy.nodes().not('[company]').not('[gtype]').toggleClass('nolabel', !show))
    }
    syncLabels()
    cy.on('zoom', syncLabels)

    if (focusPerson) cy.getElementById(focusPerson).addClass('focused')

    // --- drag one person onto another to propose a connection ---------------
    const isPerson = (id: string) => !id.startsWith('co-') && !id.startsWith('g-')
    const HIT = 34 // centres this close means "dropped on top of"
    const targetUnder = (node: cytoscape.NodeSingular) => {
      const p = node.position()
      const near: { node: cytoscape.NodeSingular; d: number }[] = []
      cy.nodes().forEach((m) => {
        if (m.id() === node.id() || !isPerson(m.id())) return
        const q = m.position()
        const d = Math.hypot(p.x - q.x, p.y - q.y)
        if (d < HIT) near.push({ node: m, d })
      })
      near.sort((a, b) => a.d - b.d)
      return near[0]?.node ?? null
    }

    cy.on('drag', 'node', (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      cy.nodes('.drop-target').removeClass('drop-target')
      if (!isPerson(node.id())) return
      targetUnder(node)?.addClass('drop-target')
    })

    cy.on('dragfree', 'node', (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      cy.nodes('.drop-target').removeClass('drop-target')
      const hit = isPerson(node.id()) ? targetUnder(node) : null
      // Always snap back — the layout is deterministic, dragging is only a
      // gesture for linking, not a way to rearrange the chart.
      const home = positions[node.id()]
      if (home) node.position(home)
      if (hit) setPendingLink({ from: node.id(), to: hit.id() })
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
  }, [elements, focusPerson, themeTick])

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
        {/* Cytoscape injects `.__________cytoscape_container { position: relative }`
            at runtime, which lands after Tailwind in the cascade and beats
            `absolute inset-0` — collapsing the box to zero height and rendering
            nothing. Size it with explicit width/height so position is irrelevant. */}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

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

      {pendingLink && (
        <ConnectModal
          from={byId.get(pendingLink.from)}
          to={byId.get(pendingLink.to)}
          pending={addLink.isPending}
          error={addLink.isError ? (addLink.error as Error).message : null}
          onCancel={() => setPendingLink(null)}
          onConfirm={async (relation, strength) => {
            await addLink.mutateAsync({
              from_contact: pendingLink.from,
              to_contact: pendingLink.to,
              relation,
              strength,
            })
            setPendingLink(null)
          }}
        />
      )}

      <p className="text-xs text-slate-600">
        Search a name to see just their network, or click a <span className="text-sky-500">company</span> hub to explore
        everyone there. Drag to pan · scroll to zoom. Blue hubs group people by shared employer; dashed lines are group
        memberships; solid lines are direct connections you've added (thicker = stronger). Drag one person onto
        another to connect them.
      </p>
    </div>
  )
}
