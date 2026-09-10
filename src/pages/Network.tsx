import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { ContactOverview, GroupType } from '../lib/types'
import {
  api,
  useAllGroupMembers,
  useAllWorkHistory,
  useContacts,
  useGroupCompanies,
  useGroups,
  useMut,
  usePhotoUrls,
  useRelationships,
} from '../lib/hooks'
import {
  clusteredLayout,
  egoPositions,
  FALLBACK_ASPECT,
  geoFor,
  hubLabel,
  rowsLayout,
  type Hull,
  type Pos,
} from '../lib/networkLayout'
import { clearNodePositions, loadNodePositions, saveNodePositions } from '../lib/networkPrefs'
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

// Below this the chart is too cramped to read, and the page scrolls instead.
const GRAPH_MIN_HEIGHT = 360

// Baseline connection-line weight. In the focused view a direct association is
// drawn at twice this and a company or group link at half.
const EDGE_W = 2.5

type Selected = { kind: 'contact'; id: string } | { kind: 'group'; id: string } | { kind: 'company'; key: string } | null

/** How the overview places its clusters. Rows is the older, simpler packing. */
type LayoutMode = 'rows' | 'clustered'

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
  onConfirm: (comment: string) => void
}) {
  const [comment, setComment] = useState('')
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
        <label className="block text-xs text-slate-400">
          Comment (optional)
          <input
            className={input}
            placeholder="How do they know each other?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={() => onConfirm(comment)} disabled={pending}>
            {pending ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * How tall the chart can be without pushing the page into a scroll.
 *
 * This used to be `calc(100vh - 250px)` — a guess at how much chrome sits
 * above, and wrong whenever that changes: the overdue banner appearing, the
 * layout notice showing, the focus strip arriving, the filter row wrapping on a
 * narrow window, or the text-size setting moving every rem on the page. When
 * the guess ran long the card overflowed the viewport and took the selection
 * panel pinned to its bottom edge off-screen with it.
 *
 * Measuring the gap above instead is right in all of those cases. The top is
 * taken document-relative so a scrolled page can't feed back into the height
 * and chase itself.
 */
function useAvailableHeight(ref: React.RefObject<HTMLElement | null>, min: number) {
  const [fit, setFit] = useState<{ height: number; clamped: boolean } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      const main = el.closest('main')
      // main reserves room for the mobile tab bar, so read it rather than
      // assuming a desktop-sized gutter.
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 24
      const room = Math.round(window.innerHeight - top - pad)
      // Below the floor the chart would be too cramped to read, so it keeps the
      // floor and the page scrolls instead — and the caller pins the selection
      // panel to the window, since it can no longer ride the card's bottom edge
      // and stay on screen.
      const next = { height: Math.max(min, room), clamped: room < min }
      setFit((prev) =>
        prev && Math.abs(prev.height - next.height) <= 1 && prev.clamped === next.clamped ? prev : next,
      )
    }
    measure()
    window.addEventListener('resize', measure)
    // Anything above the chart changing height moves it, and none of it is a
    // window resize: the banner, a dismissed notice, a wrapping filter row.
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [ref, min])
  return fit
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
  const { data: groupCompanies } = useGroupCompanies()
  const { data: allWork } = useAllWorkHistory()
  const { data: photos } = usePhotoUrls((contacts ?? []).map((c) => c.photo_url))
  const [params] = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartCardRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [selected, setSelected] = useState<Selected>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'business' | 'personal'>('all')
  const [groupFilter, setGroupFilter] = useState(params.get('group') ?? '')
  // Focus is a set: double-tapping another person adds their network to the
  // view rather than replacing it.
  const [focusPeople, setFocusPeople] = useState<string[]>(() => (params.get('focus') ? [params.get('focus')!] : []))
  const [focusCompany, setFocusCompany] = useState<string | null>(null)
  // Drag one person onto another to propose a connection.
  const [pendingLink, setPendingLink] = useState<{ from: string; to: string } | null>(null)
  // Redraw when the theme changes so the canvas picks up the new palette — the
  // graph is drawn once to a canvas, so CSS alone can't restyle it.
  const [themeTick, setThemeTick] = useState(0)
  // Mirrors cy.zoom() so the slider tracks scroll/pinch zoom too, not just its own drags.
  const [zoomLevel, setZoomLevel] = useState(1)
  // How clusters are placed on the overview: packed into rows in an order that
  // keeps related ones adjacent, or settled by shared membership so they sit
  // against each other. Remembered, since it's a preference not a mode.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    () => (localStorage.getItem('networkLayout') === 'rows' ? 'rows' : 'clustered'),
  )
  // 0 = the roomy spacing this chart shipped with, 1 = as tight as labels allow.
  const [density, setDensity] = useState(() => {
    const v = Number(localStorage.getItem('networkDensity'))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
  })
  // The slider moves freely; the layout follows once it settles. Every change
  // rebuilds the whole graph, which is far too much to do per pixel of a drag.
  const [appliedDensity, setAppliedDensity] = useState(density)
  // Nodes the user has dragged somewhere of their own choosing. Kept in a ref so
  // moving a node doesn't re-render (and so rebuild) the graph mid-drag; the
  // counter in state is only there to drive the "Reset layout" button.
  const loaded = useRef(loadNodePositions())
  const movedRef = useRef<Record<string, Pos>>(loaded.current.positions)
  const [movedCount, setMovedCount] = useState(() => Object.keys(movedRef.current).length)
  // Shown once when a saved arrangement had to be dropped because the layout
  // changed underneath it, so the loss is explained rather than just noticed.
  const [layoutReset, setLayoutReset] = useState(() => loaded.current.discarded)
  const addLink = useMut(api.addRelationship)
  const chartFit = useAvailableHeight(chartCardRef, GRAPH_MIN_HEIGHT)

  useEffect(() => {
    const t = setTimeout(() => setAppliedDensity(density), 180)
    return () => clearTimeout(t)
  }, [density])

  // Closing the info card is a deselect: without this the node keeps its ring
  // and its connections stay lit with nothing on screen explaining why.
  useEffect(() => {
    if (selected === null) cyRef.current?.nodes().unselect()
  }, [selected])

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const byId = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, c])), [contacts])

  // Company names the user has mapped onto a group: normalized name -> group.
  // Those names share the group's key, so several spellings of one employer
  // ("Macquarie Group", "Macquarie Bank") collapse into a single hub.
  const aliasToGroup = useMemo(() => {
    const byGroup = new Map((groups ?? []).map((g) => [g.id, g]))
    const m = new Map<string, { key: string; display: string }>()
    for (const gc of groupCompanies ?? []) {
      const g = byGroup.get(gc.group_id)
      const key = normCompany(gc.company)
      if (!g || !key) continue
      m.set(key, { key: `grp-${g.id}`, display: g.name })
    }
    return m
  }, [groupCompanies, groups])

  // company key -> { display name, member ids }, from current company + work history.
  const companyIndex = useMemo(() => {
    const m = new Map<string, { display: string; ids: Set<string> }>()
    const add = (company: string | null, id: string) => {
      if (!company) return
      const raw = normCompany(company)
      if (!raw) return
      const mapped = aliasToGroup.get(raw)
      const key = mapped?.key ?? raw
      const e = m.get(key) ?? { display: mapped?.display ?? company.trim(), ids: new Set<string>() }
      // A mapped name always wins the label, however the hub was first created.
      if (mapped) e.display = mapped.display
      e.ids.add(id)
      m.set(key, e)
    }
    for (const c of contacts ?? []) add(c.company, c.id)
    for (const w of allWork ?? []) add(w.company, w.contact_id)
    return m
  }, [contacts, allWork, aliasToGroup])

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
    // Whoever is at the centre of the ego view, if that is the mode we're in.
    // Line weight keys off this: a link touching one of them is a direct
    // association, anything else is a step removed.
    const centreIds = new Set<string>()

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
    } else if (focusPeople.some((id) => poolIds.has(id))) {
      // Ego network: each focused person, their colleagues, group-mates and
      // connections. Several people can be focused at once, and their networks
      // are unioned so shared contacts appear once.
      const centres = focusPeople.filter((id) => poolIds.has(id))
      for (const id of centres) centreIds.add(id)
      const myGroups = new Set<string>()
      for (const centre of centres) {
        peopleIds.add(centre)
        for (const key of companiesOf.get(centre) ?? []) {
          hubKeys.add(key)
          for (const id of companyMembers(key)) peopleIds.add(id)
        }
        for (const m of memberships ?? []) if (m.contact_id === centre) myGroups.add(m.group_id)
      }
      showGroupIds = myGroups
      for (const m of memberships ?? [])
        if (myGroups.has(m.group_id) && poolIds.has(m.contact_id)) peopleIds.add(m.contact_id)
      // Two levels deep: the centre's direct connections, then those
      // connections' own direct connections. Colleague/group-mate inclusion
      // stays one level (centre only) — a different kind of association, and
      // expanding it too would balloon a big company into the whole graph.
      const directRelIds = new Set<string>()
      for (const r of rels ?? []) {
        if (centres.includes(r.from_contact) && poolIds.has(r.to_contact)) directRelIds.add(r.to_contact)
        if (centres.includes(r.to_contact) && poolIds.has(r.from_contact)) directRelIds.add(r.from_contact)
      }
      for (const id of directRelIds) peopleIds.add(id)
      for (const r of rels ?? []) {
        if (directRelIds.has(r.from_contact) && poolIds.has(r.to_contact)) peopleIds.add(r.to_contact)
        if (directRelIds.has(r.to_contact) && poolIds.has(r.from_contact)) peopleIds.add(r.from_contact)
      }
      if (peopleIds.size > MAX_PEOPLE + centres.length) {
        const rest = [...peopleIds].filter((id) => !centres.includes(id))
        const trimmed = new Set([...centres, ...rest.slice(0, MAX_PEOPLE)])
        note = `Showing ${trimmed.size} of ${peopleIds.size} connections — click a company to see more.`
        peopleIds = trimmed
      }
    } else {
      // Default overview: your biggest clusters, capped for a fast first paint.
      // Groups belong here as much as employers do — leaving them out made the
      // landing view a map of workplaces and nothing else, which is not what
      // most of these clusters actually are.
      const rankedCompanies = [...companyIndex.entries()]
        .map(([key, v]) => ({ kind: 'company' as const, key, members: [...v.ids].filter((id) => poolIds.has(id)) }))
        .filter((x) => x.members.length >= 2)
      const rankedGroups = (groups ?? [])
        .map((g) => ({
          kind: 'group' as const,
          key: g.id,
          members: (memberships ?? [])
            .filter((m) => m.group_id === g.id && poolIds.has(m.contact_id))
            .map((m) => m.contact_id),
        }))
        .filter((x) => x.members.length >= 2)
      const ranked = [...rankedCompanies, ...rankedGroups].sort((a, b) => b.members.length - a.members.length)

      // Budget counts people actually added, so a group whose members are all
      // already on the chart is nearly free — which is the common case, and the
      // reason showing groups doesn't cost a smaller company count.
      let budget = MAX_PEOPLE
      let clusters = 0
      for (const { kind, key, members } of ranked) {
        const fresh = members.filter((id) => !peopleIds.has(id))
        if (fresh.length > budget) continue
        if (kind === 'company') hubKeys.add(key)
        else showGroupIds.add(key)
        clusters++
        for (const id of members) peopleIds.add(id)
        budget -= fresh.length
      }
      const totalClusters = ranked.length
      note =
        totalClusters > clusters
          ? `Your ${clusters} biggest clusters. Search a name or click one to explore the rest.`
          : 'Search a name or click a company or group to explore.'
    }

    // ---- build cytoscape elements -----------------------------------------
    /**
     * Line-weight tier, only while a person is focused — elsewhere every line
     * keeps its usual weight. Membership of a company or group is the weakest
     * kind of association, so those spokes are marked 'via' whatever else is
     * going on.
     */
    const tier = (kind: 'direct' | 'secondary' | 'via' = 'via') =>
      centreIds.size > 0 ? { tier: kind } : {}

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
      for (const id of members)
        els.push({ data: { id: `h-${key}-${id}`, source: id, target: `co-${key}`, hub: 1, ...tier() } })
    }

    // Group nodes + memberships.
    for (const g of (groups ?? []).filter((g) => showGroupIds.has(g.id))) {
      const members = (memberships ?? []).filter((m) => m.group_id === g.id && peopleIds.has(m.contact_id))
      if (members.length === 0) continue
      const gl = hubLabel(g.name, 11)
      els.push({ data: { id: `g-${g.id}`, label: gl.text, gtype: g.type, gcolor: GROUP_COLORS[g.type], hw: gl.w, hh: gl.h } })
      for (const m of members)
        els.push({
          data: { id: `m-${g.id}-${m.contact_id}`, source: m.contact_id, target: `g-${g.id}`, membership: 1, ...tier() },
        })
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
      els.push({
        data: {
          id: `r-${r.id}`,
          source: r.from_contact,
          target: r.to_contact,
          link: 1,
          ...tier(centreIds.has(r.from_contact) || centreIds.has(r.to_contact) ? 'direct' : 'secondary'),
        },
      })
    }

    return { elements: els, shown: peopleIds.size, total: poolIds.size, note }
  }, [contacts, rels, groups, memberships, photos, kindFilter, groupFilter, focusPeople, focusCompany, companyIndex, companiesOf, byId])

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
    // Computed layout first, then anything the user has dragged into place —
    // a saved position is a deliberate override and outranks the calculation.
    // Focused on people? Use the ego layout, where distance from the centre
    // means something. Otherwise place clusters across the canvas.
    const geo = geoFor(appliedDensity)
    const box = containerRef.current.getBoundingClientRect()
    const aspect = box.height > 0 ? box.width / box.height : FALLBACK_ASPECT
    const ego = focusPeople.length > 0 ? egoPositions(elements, focusPeople, geo) : {}
    const overview =
      Object.keys(ego).length > 0
        ? { positions: ego, hulls: [] as Hull[] }
        : layoutMode === 'rows'
          ? rowsLayout(elements, geo, aspect)
          : clusteredLayout(elements, geo, aspect)
    const positions = { ...overview.positions, ...movedRef.current }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      // The graph has grown well past what full-detail redraw-per-frame can
      // keep smooth — simplify edges/labels and cache node textures while a
      // pan or zoom gesture is actually in motion, restoring full fidelity
      // the instant it settles. Cost scales with element count; interaction
      // smoothness shouldn't.
      hideEdgesOnViewport: true,
      textureOnViewport: true,
      pixelRatio: 1,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': geo.FONT,
            color: labelColor,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            // Keep labels inside their SLOT so neighbours can't collide.
            // Travels with SLOT — tightening the spacing without tightening the
            // label cap just makes neighbouring names touch.
            'text-max-width': `${geo.LABEL}px`,
            'text-wrap': 'ellipsis',
            width: geo.NODE,
            height: geo.NODE,
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
            // Every connection is just a link, so every line is drawn the same
            // — unless a person is focused, where weight shows how close the
            // association is (see the tier rules below).
            width: EDGE_W,
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
        // Focused view only: weight says how close the association is. Straight
        // to the person in the middle is double weight and full strength; person
        // to person further out is normal; through a company or group is half.
        // These come after the rules above so they win on the same edges.
        {
          selector: 'edge[tier = "direct"]',
          style: { width: EDGE_W * 2, 'line-color': edgeColor, opacity: 1 },
        },
        { selector: 'edge[tier = "secondary"]', style: { width: EDGE_W, opacity: 0.75 } },
        { selector: 'edge[tier = "via"]', style: { width: EDGE_W / 2, opacity: 0.4 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f59e0b' } },
        // The person you've focused is drawn at double size so they stand out
        // as the centre of the view.
        {
          selector: 'node.focused',
          style: {
            // Keeps its "twice the size of everyone else" reading as the
            // density control changes what everyone else's size is.
            width: geo.NODE * 1.7,
            height: geo.NODE * 1.7,
            'font-size': geo.FONT + 3,
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
        // Selecting someone picks out how they connect. These come last so they
        // win over the tier and hub/membership rules above, which set the same
        // properties. Unrelated lines are muted rather than hidden — on a chart
        // this dense, brightening a few among hundreds reads as nothing at all
        // unless the rest steps back.
        {
          selector: 'edge.assoc-near',
          style: { 'line-color': '#f59e0b', width: EDGE_W * 1.7, opacity: 1, 'z-index': 15 },
        },
        { selector: 'edge.assoc-far', style: { opacity: 0.13 } },
        {
          selector: 'node.assoc-near',
          style: { 'border-color': '#f59e0b', 'border-width': 3, 'z-index': 12 },
        },
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
    // Keep the slider tracking scroll/pinch zoom too, not just its own drags.
    setZoomLevel(cy.zoom())
    cy.on('zoom', () => setZoomLevel(cy.zoom()))

    for (const id of focusPeople) cy.getElementById(id).addClass('focused')

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
      if (hit) {
        // Landing on top of someone means "connect these two", not "park the
        // node here" — snap back and ask about the link instead.
        const home = positions[node.id()]
        if (home) node.position(home)
        setPendingLink({ from: node.id(), to: hit.id() })
        return
      }
      // Dropped on open canvas: keep it where it was put, and remember it so the
      // arrangement survives filtering, theme changes and reloads.
      const p = node.position()
      positions[node.id()] = { x: p.x, y: p.y }
      movedRef.current = { ...movedRef.current, [node.id()]: { x: p.x, y: p.y } }
      saveNodePositions(movedRef.current)
      setMovedCount(Object.keys(movedRef.current).length)
    })

    /**
     * Light up everything the selection touches directly: the lines out of it
     * and the people at the other end. Driven off cytoscape's own selection
     * rather than the tap handler, so it covers a hub, several nodes at once,
     * and the people already focused when the chart opens.
     */
    const showAssociations = () => {
      const chosen = cy.nodes(':selected')
      cy.batch(() => {
        cy.elements().removeClass('assoc-near assoc-far')
        if (chosen.empty()) return
        const near = chosen.connectedEdges()
        near.addClass('assoc-near')
        cy.edges().not(near).addClass('assoc-far')
        chosen.neighborhood('node').addClass('assoc-near')
      })
    }
    cy.on('select unselect', 'node', showAssociations)
    showAssociations()

    // Cytoscape has no double-tap event, so pair up two taps on the same node.
    let lastTap = { id: '', at: 0 }
    cy.on('tap', 'node', (evt) => {
      const id: string = evt.target.id()
      const at = Date.now()
      const double = lastTap.id === id && at - lastTap.at < 400
      lastTap = { id, at }
      if (double && isPerson(id)) {
        // Add this person's own network to whatever is already on screen.
        setFocusCompany(null)
        setFocusPeople((prev) => (prev.includes(id) ? prev : [...prev, id]))
        return
      }
      if (id.startsWith('co-')) setSelected({ kind: 'company', key: id.slice(3) })
      else if (id.startsWith('g-')) setSelected({ kind: 'group', id: id.slice(2) })
      else setSelected({ kind: 'contact', id })
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    // In the ego layout distance carries meaning, so keep the whole ring
    // structure in frame instead of zooming in on the middle of it. The fit
    // above already did that; only when it had to clamp for legibility does the
    // view need steering, and then it belongs on the focused people.
    let centres = cy.collection()
    for (const id of focusPeople) centres = centres.union(cy.getElementById(id))
    if (centres.nonempty()) {
      centres.select()
      if (cy.zoom() <= LEGIBLE_ZOOM) cy.center(centres)
    }

    // --- tinted cluster outlines -------------------------------------------
    // Cytoscape draws nodes and edges and has no notion of a region, so the
    // outlines get their own canvas underneath its layers — prepended, so
    // cytoscape's own canvases (same stacking context, later in the DOM) paint
    // over it. It follows the graph by reading cy's pan and zoom each frame.
    const hullCanvas = document.createElement('canvas')
    hullCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none'
    containerRef.current.prepend(hullCanvas)
    const hullOf = (h: Hull) => {
      const node = cy.getElementById(h.hubId)
      if (node.empty()) return null
      return (node.data('gcolor') as string | undefined) ?? hubColor
    }
    const drawHulls = () => {
      const w = containerRef.current?.clientWidth ?? 0
      const ht = containerRef.current?.clientHeight ?? 0
      if (hullCanvas.width !== w || hullCanvas.height !== ht) {
        hullCanvas.width = w
        hullCanvas.height = ht
      }
      const ctx = hullCanvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, ht)
      if (overview.hulls.length === 0) return
      const pan = cy.pan()
      const z = cy.zoom()
      for (const h of overview.hulls) {
        if (h.pts.length < 3) continue
        const color = hullOf(h)
        if (!color) continue
        ctx.beginPath()
        h.pts.forEach((p, i) => {
          const x = p.x * z + pan.x
          const y = p.y * z + pan.y
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
        ctx.globalAlpha = 0.1
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 0.34
        ctx.strokeStyle = color
        ctx.lineWidth = 1.25
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    drawHulls()
    cy.on('render', drawHulls)

    // The chart is sized to the space left over, so it can change height with
    // no window resize behind it — the overdue banner arriving is enough.
    // Cytoscape only re-reads its container on demand, and resize() keeps the
    // current zoom and pan rather than yanking the view back to a fit.
    const resizeObserver = new ResizeObserver(() => {
      cy.resize()
      drawHulls()
    })
    resizeObserver.observe(containerRef.current)

    cyRef.current = cy
    return () => {
      cyRef.current = null
      resizeObserver.disconnect()
      cy.off('select unselect', 'node', showAssociations)
      cy.off('render', drawHulls)
      hullCanvas.remove()
      cy.destroy()
    }
  }, [elements, focusPeople, themeTick, layoutMode, appliedDensity])

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const s = search.trim().toLowerCase()
    if (!s) return
    const match = (contacts ?? []).find((c) => fullName(c).toLowerCase().includes(s))
    if (match) {
      setFocusCompany(null)
      setFocusPeople([match.id])
      setSelected({ kind: 'contact', id: match.id })
    }
  }

  const focusOnCompany = (key: string) => {
    setFocusPeople([])
    setFocusCompany(key)
    setSelected(null)
  }
  const clearFocus = () => {
    setFocusPeople([])
    setFocusCompany(null)
    setSelected(null)
  }

  const switchLayout = (m: LayoutMode) => {
    setLayoutMode(m)
    localStorage.setItem('networkLayout', m)
  }

  const changeDensity = (d: number) => {
    setDensity(d)
    localStorage.setItem('networkDensity', String(d))
  }

  /** Throw away every dragged position and put the calculated layout back. */
  const resetLayout = () => {
    movedRef.current = {}
    clearNodePositions()
    setMovedCount(0)
    const cy = cyRef.current
    if (!cy) return
    const geo = geoFor(appliedDensity)
    const box = containerRef.current?.getBoundingClientRect()
    const aspect = box && box.height > 0 ? box.width / box.height : FALLBACK_ASPECT
    const ego = focusPeople.length > 0 ? egoPositions(elements, focusPeople, geo) : {}
    const home =
      Object.keys(ego).length > 0
        ? ego
        : (layoutMode === 'rows' ? rowsLayout(elements, geo, aspect) : clusteredLayout(elements, geo, aspect)).positions
    cy.batch(() =>
      cy.nodes().forEach((n) => {
        const p = home[n.id()]
        if (p) n.position(p)
      }),
    )
    cy.fit(undefined, 50)
    if (cy.zoom() < 0.55) cy.zoom(0.55)
  }

  // Focusing on people switches the chart to the ego layout, where distance
  // means hops from the centre — the cluster-placement choice has nothing to
  // act on there.
  const egoView = focusPeople.length > 0
  const selectedContact = selected?.kind === 'contact' ? byId.get(selected.id) : null
  const selectedGroup = selected?.kind === 'group' ? (groups ?? []).find((g) => g.id === selected.id) : null
  const selectedCompany = selected?.kind === 'company' ? companyIndex.get(selected.key) : null
  const hasAnything = (contacts ?? []).length > 0

  const focusNames = focusPeople.map((id) => ({ id, name: (byId.get(id) && fullName(byId.get(id)!)) || 'person' }))
  const focusLabel = focusNames.length > 0
    ? focusNames.map((f) => f.name).join(' + ')
    : focusCompany
      ? companyIndex.get(focusCompany)?.display ?? 'company'
      : null

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Network</h1>
        <div className="flex items-center gap-2">
          {movedCount > 0 && (
            <button onClick={resetLayout} className={btnGhost} title="Put every node back where the layout puts it">
              Reset layout
            </button>
          )}
          <Link to="/groups" className={btnGhost}>
            Manage groups
          </Link>
        </div>
      </header>

      {layoutReset && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-slate-300">
          <Icon name="star" className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" filled />
          <p className="flex-1">
            The chart lays clusters out differently now — groups that share people sit together, and the spacing is
            tighter. Nodes you had dragged into place were positioned for the old layout, so they've been put back where
            the chart puts them.
          </p>
          <button onClick={() => setLayoutReset(false)} className="text-slate-500 hover:text-slate-300" aria-label="Dismiss">
            <Icon name="x" className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
        {/* Two ways to place the clusters. Rows is quicker to read down;
            clustered puts groups that share people against each other. Neither
            applies while somebody is focused — there the rings mean hops from
            that person — so the buttons go dim rather than quietly doing
            nothing when pressed. */}
        <div
          className={`flex rounded-lg border border-slate-700 overflow-hidden ${egoView ? 'opacity-40' : ''}`}
          role="group"
          aria-label="Cluster layout"
        >
          {(['clustered', 'rows'] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchLayout(m)}
              disabled={egoView}
              className={`px-2.5 py-2 text-xs capitalize disabled:cursor-not-allowed ${
                layoutMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 enabled:hover:text-slate-200'
              }`}
              aria-pressed={layoutMode === m}
              title={
                egoView
                  ? 'Not used while focused on someone — there the rings show how many steps away each person is'
                  : m === 'clustered'
                    ? 'Groups that share people sit against each other'
                    : 'Clusters packed into rows, related ones adjacent'
              }
            >
              {m}
            </button>
          ))}
        </div>
        {/* Labelled at both ends: it starts at the tight end, so without them
            half the travel looks broken rather than already-there. */}
        <label
          className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0"
          title="How much of the chart is people rather than empty space"
        >
          <span>airy</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={density}
            onChange={(e) => changeDensity(Number(e.target.value))}
            className="w-20 accent-indigo-500"
            aria-label="Layout density"
          />
          <span>dense</span>
        </label>
      </div>

      {(focusLabel || note) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {focusNames.length > 0 ? (
            <>
              <span>Focused on</span>
              {focusNames.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFocusPeople((prev) => prev.filter((id) => id !== f.id))}
                  className={`${chip} bg-indigo-600/20 text-indigo-300 inline-flex items-center gap-1`}
                  title="Drop this person from the view"
                >
                  {f.name}
                  <Icon name="x" className="w-3 h-3" />
                </button>
              ))}
              {focusNames.length > 1 && (
                <button onClick={clearFocus} className="hover:text-slate-300 underline">
                  clear all
                </button>
              )}
            </>
          ) : (
            focusLabel && (
              <button onClick={clearFocus} className={`${chip} bg-indigo-600/20 text-indigo-300 inline-flex items-center gap-1`}>
                Focused on {focusLabel}
                <Icon name="x" className="w-3 h-3" />
              </button>
            )
          )}
          {note && <span>{note}</span>}
          {!focusLabel && shown < total && <span>· {shown} of {total} people shown</span>}
        </div>
      )}

      <div ref={chartCardRef} className={`${card} relative overflow-hidden`} style={{ height: chartFit?.height, minHeight: GRAPH_MIN_HEIGHT }}>
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

        {hasAnything && elements.length > 0 && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-1.5 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-full py-3 px-2">
            <span className="text-sm text-slate-500 select-none leading-none">+</span>
            <div className="h-28 w-5 flex items-center justify-center">
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={zoomLevel}
                onChange={(e) => {
                  const cy = cyRef.current
                  if (!cy) return
                  cy.zoom({ level: Number(e.target.value), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
                }}
                className="w-28 accent-indigo-500"
                style={{ transform: 'rotate(-90deg)' }}
                aria-label="Zoom level"
              />
            </div>
            <span className="text-sm text-slate-500 select-none leading-none">−</span>
          </div>
        )}

        {(selectedContact || selectedGroup || selectedCompany) && (
          <div
            className={`${
              chartFit?.clamped ? 'fixed bottom-20 sm:bottom-3 left-3 right-3 sm:right-auto z-30' : 'absolute bottom-3 left-3 right-3 sm:right-auto z-10'
            } sm:w-72 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3`}
          >
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
                    {!focusPeople.includes(selectedContact.id) && (
                      <button
                        onClick={() => {
                          setFocusCompany(null)
                          setFocusPeople([selectedContact.id])
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
          onConfirm={async (comment) => {
            await addLink.mutateAsync({
              from_contact: pendingLink.from,
              to_contact: pendingLink.to,
              notes: comment,
            })
            setPendingLink(null)
          }}
        />
      )}

      <p className="text-xs text-slate-600">
        Search a name to see just their network, or click a <span className="text-sky-500">company</span> or group hub to
        explore everyone there. Drag to pan · scroll or the slider on the left to zoom. Blue hubs group people by shared
        employer, coloured ones by group, and a tint shows how far each cluster reaches — where two tints overlap, those
        are people who belong to both. <strong className="text-slate-500">Clustered</strong> pulls groups that share
        people against each other; <strong className="text-slate-500">rows</strong> packs them into lines instead, with
        related ones adjacent. The airy/dense slider trades empty space for bigger, more readable people. Dashed lines are group memberships;
        solid lines are direct connections you've added. Focused on someone, the ring nearest them is who
        they're directly connected to — several circles deep if there are a lot — then a gap, then the people connected to
        those. Anyone linked only by a shared company or group clusters around that pill, outside every band. Line weight matches: bold straight to them, normal between two other
        people, thin through a company or group — double-click anyone to add their network to the view as well. Drag a node anywhere to rearrange the chart — it stays put; drop one
        person on top of another to connect them. "Reset layout" puts everything back.
      </p>
    </div>
  )
}
