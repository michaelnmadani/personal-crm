/**
 * Layout maths for the network graph — where every node goes, and the outlines
 * drawn behind each cluster. Pure geometry with no React and no cytoscape
 * runtime: the page hands it an element list and gets positions back, which is
 * what makes the placement rules checkable on their own.
 */
import type cytoscape from 'cytoscape'

/**
 * Every distance the layouts use, as one set. Spacing is driven by label width
 * rather than circle width — that's what stops names from colliding — so the
 * label cap travels with it: tightening SLOT without tightening LABEL just
 * makes names touch.
 *
 * ROOMY is the geometry this chart shipped with. TIGHT is the same layout with
 * the air taken out; the density control mixes between the two, so "how packed
 * is this" is a preference rather than a constant somebody has to guess.
 */
export type Geo = {
  SLOT: number
  RING_0: number
  RING_STEP: number
  CLUSTER_GAP: number
  BAND_GAP: number
  HUB_GAP: number
  ORBIT_SLOT: number
  ORBIT_0: number
  ORBIT_STEP: number
  LABEL: number
  /**
   * Person-circle diameter and label size, in the same graph units as the
   * spacing above. These are why the control is felt at all: the view is
   * fitted to the card, so shrinking every distance in step just zooms back
   * in and nothing changes on screen. Node and label size are what survive
   * that, so tight draws bigger circles into tighter spacing and the ink per
   * screen actually rises.
   */
  NODE: number
  FONT: number
}

const ROOMY: Geo = {
  SLOT: 132, RING_0: 165, RING_STEP: 104, CLUSTER_GAP: 90,
  BAND_GAP: 70, HUB_GAP: 130,
  ORBIT_SLOT: 92, ORBIT_0: 100, ORBIT_STEP: 70,
  LABEL: 112,
  NODE: 24, FONT: 8,
}
const TIGHT: Geo = {
  SLOT: 104, RING_0: 118, RING_STEP: 86, CLUSTER_GAP: 56,
  BAND_GAP: 48, HUB_GAP: 96,
  ORBIT_SLOT: 76, ORBIT_0: 78, ORBIT_STEP: 58,
  LABEL: 88,
  NODE: 40, FONT: 11,
}

/** Geometry at a density of 0 (roomy) through 1 (tight). */
export function geoFor(density: number): Geo {
  const t = Math.min(1, Math.max(0, density))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return {
    SLOT: mix(ROOMY.SLOT, TIGHT.SLOT),
    RING_0: mix(ROOMY.RING_0, TIGHT.RING_0),
    RING_STEP: mix(ROOMY.RING_STEP, TIGHT.RING_STEP),
    CLUSTER_GAP: mix(ROOMY.CLUSTER_GAP, TIGHT.CLUSTER_GAP),
    BAND_GAP: mix(ROOMY.BAND_GAP, TIGHT.BAND_GAP),
    HUB_GAP: mix(ROOMY.HUB_GAP, TIGHT.HUB_GAP),
    ORBIT_SLOT: mix(ROOMY.ORBIT_SLOT, TIGHT.ORBIT_SLOT),
    ORBIT_0: mix(ROOMY.ORBIT_0, TIGHT.ORBIT_0),
    ORBIT_STEP: mix(ROOMY.ORBIT_STEP, TIGHT.ORBIT_STEP),
    LABEL: mix(ROOMY.LABEL, TIGHT.LABEL),
    NODE: mix(ROOMY.NODE, TIGHT.NODE),
    FONT: mix(ROOMY.FONT, TIGHT.FONT),
  }
}

// A touch under half a turn. Wider than this and the ends of the fan swing back
// towards the bands, close enough to read as belonging to them.
const ORBIT_ARC = Math.PI * 0.95

/**
 * The graph card is full width and calc(100vh - 250px) tall — roughly 2:1 on a
 * laptop. The clustered layout aims its packing at the container's real shape:
 * left to itself a force packing settles into a circular blob, which on a wide
 * card means tighter clusters but *more* empty screen, which is the opposite of
 * the point.
 */
export const FALLBACK_ASPECT = 2.15

// Successive turns of this angle never repeat or bunch up, which makes it a
// good way to scatter things that have no direction of their own.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export type Pos = { x: number; y: number }

/**
 * Wrap a hub name onto multiple lines and return the pill size that fits it.
 * Cytoscape's `width: 'label'` auto-sizing is deprecated (it resolves to zero),
 * so the pill is measured here and fed back through data() mappers.
 */
export function hubLabel(name: string, fontPx: number, maxChars = 18) {
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

type ElData = {
  id: string
  source?: string
  target?: string
  company?: number
  gtype?: string
  hub?: number
  membership?: number
}

/**
 * Ego layout, used whenever the chart is focused on one or more people.
 *
 * Distance carries meaning here. The focused people sit at the centre, ringed
 * by everyone they're directly connected to; beyond a clear gap comes the next
 * band, the people connected to *those* people, and so on outward.
 *
 * A band is one circle when its people fit on one, and two or three tightly
 * spaced circles when there are too many — a hundred direct connections belong
 * in a few layers around the centre, not on one enormous ring. Within a band,
 * everyone is placed as near as an even circle allows to whoever they're
 * connected to on the band inside, which keeps the joining lines short.
 *
 * Anyone the chain never reaches is on the chart only because they share an
 * employer or a group. Those people don't belong in a band — being one out
 * would imply a closeness that isn't there — so the hub pills sit outside every
 * band and those contacts cluster around their own pill instead, the way the
 * unfocused chart draws every company.
 */
export function egoPositions(
  els: cytoscape.ElementDefinition[],
  focusIds: string[],
  geo: Geo,
): Record<string, Pos> {
  const { SLOT, RING_0, RING_STEP, BAND_GAP, HUB_GAP, ORBIT_SLOT, ORBIT_0, ORBIT_STEP } = geo
  const data = (e: cytoscape.ElementDefinition) => e.data as unknown as ElData

  const nodes = els.filter((e) => !data(e).source)
  const isHub = (e: cytoscape.ElementDefinition) => !!(data(e).company || data(e).gtype)
  const hubIds = nodes.filter(isHub).map((e) => data(e).id)
  const peopleIds = nodes.filter((e) => !isHub(e)).map((e) => data(e).id)

  const present = new Set(peopleIds)
  const focus = focusIds.filter((id) => present.has(id))
  if (focus.length === 0) return {}

  // Adjacency over the connections you've drawn — hub spokes and group
  // memberships are deliberately excluded, since sharing an employer is not
  // the same as knowing someone.
  const adj = new Map<string, string[]>()
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || d.hub || d.membership) continue
    adj.set(d.source, [...(adj.get(d.source) ?? []), d.target])
    adj.set(d.target, [...(adj.get(d.target) ?? []), d.source])
  }

  // Hops from the centre: 1 is a direct association, 2+ is reached through
  // somebody else, absent means no chain of connections gets there at all.
  const hops = new Map<string, number>(focus.map((id) => [id, 0]))
  let frontier = [...focus]
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier)
      for (const nb of adj.get(id) ?? []) {
        if (!present.has(nb) || hops.has(nb)) continue
        hops.set(nb, depth)
        next.push(nb)
      }
    frontier = next
  }

  // Everyone each hub holds, and separately the one hub that claims each person.
  // The two differ: somebody at a company who is also in a club belongs to both
  // hubs, but can only orbit one of them. Aiming a pill needs the full list —
  // using only the people it claims leaves a group whose members all work
  // somewhere else with no direction at all, stranded away from its own people.
  const membersOf = new Map<string, string[]>(hubIds.map((h) => [h, []]))
  const hubOf = new Map<string, string>()
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || (!d.hub && !d.membership)) continue
    if (!membersOf.has(d.target)) continue
    membersOf.get(d.target)!.push(d.source)
    if (!hubOf.has(d.source)) hubOf.set(d.source, d.target)
  }
  const hubSize = new Map<string, number>([...membersOf].map(([h, m]) => [h, m.length]))
  // Bigger hubs first, so the same employer keeps the same slice of the circle
  // in every ring and they line up radially.
  const hubOrder = new Map([...hubIds].sort((a, b) => (hubSize.get(b) ?? 0) - (hubSize.get(a) ?? 0)).map((h, i) => [h, i]))
  const byHub = (ids: string[]) =>
    [...ids].sort((a, b) => (hubOrder.get(hubOf.get(a) ?? '') ?? 99) - (hubOrder.get(hubOf.get(b) ?? '') ?? 99))

  // Everyone the connection chain reaches, grouped by how many hops away.
  const ringsByHop = new Map<number, string[]>()
  for (const id of peopleIds) {
    const h = hops.get(id)
    if (h === undefined || h === 0) continue
    ringsByHop.set(h, [...(ringsByHop.get(h) ?? []), id])
  }
  // …and everyone it doesn't, waiting to be parked around their own hub.
  const orbiters = new Map<string, string[]>()
  const homeless: string[] = []
  for (const id of peopleIds) {
    if (hops.has(id)) continue
    const h = hubOf.get(id)
    if (h) orbiters.set(h, [...(orbiters.get(h) ?? []), id])
    else homeless.push(id)
  }

  const positions: Record<string, Pos> = {}
  const angles = new Map<string, number>()
  /** Radius a ring of n nodes needs before their labels start to touch. */
  const fits = (n: number) => (n * SLOT) / (2 * Math.PI)
  /** How many nodes a ring of this radius can hold without labels colliding. */
  const capacity = (r: number) => Math.max(4, Math.floor((2 * Math.PI * r) / SLOT))

  /**
   * Lay one hop level out as a band: a single circle when it fits, otherwise
   * two or three concentric circles close together, with consecutive nodes
   * alternating between them so each circle gets the room it needs.
   *
   * `ids` arrive in the angular order they should appear in. `want` optionally
   * gives each one the angle it would rather sit at — the whole band is then
   * turned so the slots land as near those angles as possible, which is what
   * keeps a person beside the contact they're connected to and the joining
   * line short.
   */
  const placeBand = (ids: string[], from: number, want?: Map<string, number>) => {
    const n = ids.length
    if (n === 0) return from
    let base = Math.max(from, RING_0 / 2)
    let layers = Math.max(1, Math.ceil(n / capacity(base)))
    // Three circles deep is plenty; past that, push the whole band outward
    // rather than stacking more layers into it.
    layers = Math.min(layers, 3)
    while (capacity(base) * layers < n) base += RING_STEP / 2

    const step = (2 * Math.PI) / n
    let turn = -Math.PI / 2
    if (want) {
      // Circular mean of "wanted angle minus slot angle" is the single rotation
      // that puts the band closest to everyone's preference at once.
      let sx = 0
      let sy = 0
      ids.forEach((id, i) => {
        const a = want.get(id)
        if (a === undefined) return
        sx += Math.cos(a - i * step)
        sy += Math.sin(a - i * step)
      })
      if (sx !== 0 || sy !== 0) turn = Math.atan2(sy, sx)
    }

    ids.forEach((id, i) => {
      const a = i * step + turn
      const r = base + (i % layers) * RING_STEP
      angles.set(id, a)
      positions[id] = { x: r * Math.cos(a), y: r * Math.sin(a) }
    })
    return base + (layers - 1) * RING_STEP
  }

  /** Where a person would sit if they could stand next to whoever they know. */
  const wantedAngle = (ids: string[]) => {
    const m = new Map<string, number>()
    for (const id of ids) {
      let sx = 0
      let sy = 0
      for (const nb of adj.get(id) ?? []) {
        const a = angles.get(nb)
        if (a === undefined) continue
        sx += Math.cos(a)
        sy += Math.sin(a)
      }
      if (sx !== 0 || sy !== 0) m.set(id, Math.atan2(sy, sx))
    }
    return m
  }

  // Centre: one person sits at the origin, several share a small huddle.
  let edge = 0
  if (focus.length === 1) {
    positions[focus[0]] = { x: 0, y: 0 }
  } else {
    edge = placeBand(byHub(focus), fits(focus.length))
  }

  // A band per hop outward, each separated from the last by a clear gap so the
  // rings read as distinct bands rather than one dense field of circles.
  let from = Math.max(edge + RING_STEP, RING_0)
  for (const hop of [...ringsByHop.keys()].sort((a, b) => a - b)) {
    const ids = ringsByHop.get(hop)!
    if (hop === 1) {
      // Nothing to sit beside yet — group them by employer instead.
      edge = placeBand(byHub(ids), from)
    } else {
      // Sort by the angle each would prefer, then hand out slots in that order:
      // everyone ends up as near their own contact as an even circle allows.
      const want = wantedAngle(ids)
      const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      const ordered = [...ids].sort((a, b) => norm(want.get(a) ?? 0) - norm(want.get(b) ?? 0))
      edge = placeBand(ordered, from, want)
    }
    from = edge + RING_STEP + BAND_GAP
  }

  // Hubs last, just outside the final band, each aimed at the mean angle of its
  // members and carrying its own group-only people in a tight fan beside it.
  const shownHubs = hubIds.filter((h) => (hubSize.get(h) ?? 0) > 0)
  if (shownHubs.length > 0) {
    /**
     * Plan a cluster of n people packed against a pill and fanned away from the
     * chart's centre: fill the arc closest to the pill, then the next one out,
     * and so on. Filling by what each arc holds is what keeps the first row
     * hard against the pill however many people there are — sizing one arc to
     * take everybody would push even the nearest of them far away.
     */
    const orbitPlan = (n: number) => {
      const rings: { r: number; count: number }[] = []
      let left = n
      for (let j = 0; left > 0; j++) {
        const r = ORBIT_0 + j * ORBIT_STEP
        const take = Math.min(Math.max(3, Math.floor((ORBIT_ARC * r) / ORBIT_SLOT)), left)
        rings.push({ r, count: take })
        left -= take
      }
      return { rings, outer: rings.length > 0 ? rings[rings.length - 1].r : 0 }
    }
    const plans = new Map(shownHubs.map((h) => [h, orbitPlan((orbiters.get(h) ?? []).length)]))
    const widest = Math.max(0, ...[...plans.values()].map((p) => p.outer))
    // The pill itself sits just clear of the last band: its people fan outward
    // from there, so the name stays close to the network it belongs to.
    const rHub = edge + HUB_GAP

    /**
     * The direction a pill should sit in: the average angle of its members that
     * are out on a band. A hub whose people are all group-only has no bearing of
     * its own — those return null and get spread into the gaps afterwards.
     */
    const mean = (h: string) => {
      let sx = 0
      let sy = 0
      for (const id of membersOf.get(h) ?? []) {
        const a = angles.get(id)
        if (a === undefined) continue
        sx += Math.cos(a)
        sy += Math.sin(a)
      }
      return sx === 0 && sy === 0 ? null : Math.atan2(sy, sx)
    }
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const aimed = shownHubs.map((h) => ({ h, a: mean(h) }))
    // Anything with no bearing is fanned out from straight up rather than
    // stacked there, so unanchored pills don't all land on the same spot.
    let free = 0
    const placed = aimed
      .map(({ h, a }) => ({ h, a: norm(a ?? -Math.PI / 2 + free++ * GOLDEN_ANGLE) }))
      .sort((x, y) => x.a - y.a)
    // Two hubs whose members sit in the same direction would land on top of each
    // other, so keep an arc between them wide enough for their clusters too.
    const minSep = Math.min(
      (2 * Math.PI) / placed.length,
      2 * Math.atan(widest / Math.max(rHub, 1)) + SLOT / Math.max(rHub, 1),
    )
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].a - placed[i - 1].a < minSep) placed[i].a = placed[i - 1].a + minSep
    }
    // If pushing them apart wrapped past the start, give up and space them evenly.
    if (placed.length > 1 && placed[placed.length - 1].a - placed[0].a > 2 * Math.PI - minSep) {
      placed.forEach((p, i) => (p.a = (i * 2 * Math.PI) / placed.length))
    }
    for (const { h, a } of placed) {
      const cx = rHub * Math.cos(a)
      const cy = rHub * Math.sin(a)
      positions[h] = { x: cx, y: cy }
      const crowd = byHub(orbiters.get(h) ?? [])
      const plan = plans.get(h)!
      let i = 0
      for (const [ri, ring] of plan.rings.entries()) {
        const step = ORBIT_ARC / Math.max(ring.count, 1)
        // Half-step offset on alternate rows so names don't line up radially.
        const phase = ri % 2 ? step / 2 : 0
        for (let k = 0; k < ring.count; k++, i++) {
          const t = a + (k - (ring.count - 1) / 2) * step + phase
          positions[crowd[i]] = { x: cx + ring.r * Math.cos(t), y: cy + ring.r * Math.sin(t) }
        }
      }
    }
  }

  // Anyone with neither a chain nor a hub (shouldn't normally happen) goes in a
  // band of their own rather than piling up on the origin.
  if (homeless.length > 0) placeBand(byHub(homeless), edge + RING_STEP + BAND_GAP)

  return positions
}

/** A tinted outline drawn behind one cluster, in graph coordinates. */
export type Hull = { hubId: string; pts: Pos[] }
export type Layout = { positions: Record<string, Pos>; hulls: Hull[] }

/** Convex hull of a point set (Andrew's monotone chain). */
function convexHull(pts: Pos[]): Pos[] {
  if (pts.length < 3) return [...pts]
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pos, a: Pos, b: Pos) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pos[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pos[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * A soft outline around a cluster: the convex hull pushed outward and then
 * corner-cut twice, so the tint reads as a shape the people sit inside rather
 * than a polygon drawn around them. Where two clusters share people their
 * outlines overlap, which is exactly the thing worth seeing.
 */
function hullFor(pts: Pos[], pad: number): Pos[] {
  if (pts.length === 0) return []
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const circle = () => {
    const r = pad + Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)))
    return Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    })
  }
  if (pts.length < 3) return circle()
  const hull = convexHull(pts)
  // A two-person cluster puts its people on opposite sides of the hub, so the
  // hull through them is a straight line and the tint draws as a splinter. Any
  // near-collinear set has the same problem; a circle is the honest shape for
  // "these few, around here".
  const area =
    Math.abs(
      hull.reduce((s, p, i) => {
        const q = hull[(i + 1) % hull.length]
        return s + (p.x * q.y - q.x * p.y)
      }, 0),
    ) / 2
  if (area < (pad * 2) ** 2 * 0.6) return circle()
  let ring = hull.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad }
  })
  for (let pass = 0; pass < 2; pass++) {
    const out: Pos[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    ring = out
  }
  return ring
}

/**
 * Pull the hub/person structure out of the element list once, so both overview
 * layouts read the graph the same way.
 *
 * `hubsOf` keeps *every* hub a person belongs to. The old layout kept only the
 * first and dropped the rest, which is why somebody at a company who was also
 * in a club only ever appeared under the company.
 */
function readGraph(els: cytoscape.ElementDefinition[]) {
  type D = {
    id: string
    source?: string
    target?: string
    company?: number
    gtype?: string
    hub?: number
    membership?: number
  }
  const data = (e: cytoscape.ElementDefinition) => e.data as unknown as D

  const nodes = els.filter((e) => !data(e).source)
  const hubIds = nodes.filter((e) => data(e).company || data(e).gtype).map((e) => data(e).id)
  const peopleIds = nodes.filter((e) => !data(e).company && !data(e).gtype).map((e) => data(e).id)
  const hubSet = new Set(hubIds)

  const membersOf = new Map<string, string[]>(hubIds.map((h) => [h, []]))
  const hubsOf = new Map<string, string[]>()
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || (!d.hub && !d.membership) || !hubSet.has(d.target)) continue
    if ((hubsOf.get(d.source) ?? []).includes(d.target)) continue
    membersOf.get(d.target)!.push(d.source)
    hubsOf.set(d.source, [...(hubsOf.get(d.source) ?? []), d.target])
  }

  // Adjacency over the connections you've drawn — hub spokes and group
  // memberships are deliberately excluded, since sharing an employer is not the
  // same as knowing someone.
  const adj = new Map<string, string[]>()
  const relEdges: [string, string][] = []
  for (const e of els) {
    const d = data(e)
    if (!d.source || !d.target || d.hub || d.membership) continue
    adj.set(d.source, [...(adj.get(d.source) ?? []), d.target])
    adj.set(d.target, [...(adj.get(d.target) ?? []), d.source])
    relEdges.push([d.source, d.target])
  }

  const size = (h: string) => (membersOf.get(h) ?? []).length
  /** How many people two hubs have in common — the weight everything keys off. */
  const shared = (a: string, b: string) => {
    const A = new Set(membersOf.get(a) ?? [])
    return (membersOf.get(b) ?? []).filter((p) => A.has(p)).length
  }
  return { hubIds, peopleIds, membersOf, hubsOf, adj, relEdges, size, shared }
}

/** Ring plan for n members: fill outward, each ring holding as many as fit. */
function ringsFor(n: number, geo: Geo) {
  const rings: { r: number; count: number }[] = []
  let left = n
  let r = geo.RING_0
  while (left > 0) {
    const cap = Math.max(6, Math.floor((2 * Math.PI * r) / geo.SLOT))
    const take = Math.min(cap, left)
    rings.push({ r, count: take })
    left -= take
    r += geo.RING_STEP
  }
  return rings
}

function clusterRadius(n: number, geo: Geo) {
  if (n === 0) return geo.RING_0 / 2
  const rings = ringsFor(n, geo)
  return rings[rings.length - 1].r + geo.RING_STEP / 2
}

/** Concentric ring slots around a centre, alternate rings half-step offset. */
function ringSlots(cx: number, cy: number, n: number, geo: Geo): Pos[] {
  const out: Pos[] = []
  for (const [ri, ring] of ringsFor(n, geo).entries()) {
    const step = (2 * Math.PI) / ring.count
    const phase = ri % 2 ? step / 2 : 0
    for (let k = 0; k < ring.count; k++) {
      const a = k * step + phase - Math.PI / 2
      out.push({ x: cx + ring.r * Math.cos(a), y: cy + ring.r * Math.sin(a) })
    }
  }
  return out.slice(0, n)
}

/**
 * Order a cluster's members so connected people come out consecutively. Ring
 * slots are filled in array order, so consecutive members land side by side —
 * which keeps a relationship edge a short hop between neighbours instead of a
 * chord across the whole cluster.
 */
function orderMembers(members: string[], adj: Map<string, string[]>) {
  if (adj.size === 0) return members
  const inCluster = new Set(members)
  const degree = (id: string) => (adj.get(id) ?? []).filter((n) => inCluster.has(n)).length
  const seen = new Set<string>()
  const out: string[] = []
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

/**
 * ROWS. Each hub gets its members on concentric rings, then clusters pack into
 * rows — but in an order that walks from each cluster to whichever unplaced one
 * shares the most people with it, so related clusters come out side by side
 * instead of wherever their size happened to put them.
 *
 * Deterministic, and cheap enough to run on every render. Its one limit is the
 * row wrap: a cluster that falls to the next line lands far from the one it was
 * meant to sit beside, however many people they share. That is what the
 * clustered layout below exists to fix.
 */
export function rowsLayout(els: cytoscape.ElementDefinition[], geo: Geo, aspect: number): Layout {
  const { hubIds, peopleIds, membersOf, hubsOf, adj, relEdges, size, shared } = readGraph(els)

  // A person is drawn inside one cluster — a node has one position — and it's
  // the first hub that claimed them, as before. The difference now is that
  // their other memberships are still drawn, as spokes to those hubs.
  const homeOf = new Map<string, string>()
  for (const [p, hs] of hubsOf) homeOf.set(p, hs[0])

  // Greedy affinity walk: biggest cluster first, then always the unplaced hub
  // sharing the most people with the one just laid down.
  const remaining = [...hubIds].sort((a, b) => size(b) - size(a))
  const order: string[] = []
  if (remaining.length > 0) order.push(remaining.shift()!)
  while (remaining.length > 0) {
    const last = order[order.length - 1]
    remaining.sort((a, b) => shared(last, b) - shared(last, a) || size(b) - size(a))
    order.push(remaining.shift()!)
  }

  const clusters = order.map((id) => {
    const members = orderMembers(
      (membersOf.get(id) ?? []).filter((p) => homeOf.get(p) === id),
      adj,
    )
    return { id, members, radius: clusterRadius(members.length, geo) }
  })

  // Aim the packing at the shape of the container rather than at a square, so
  // the chart fills the card instead of leaving bands of empty either side.
  const positions: Record<string, Pos> = {}
  const areaSum = clusters.reduce((s, c) => s + (2 * c.radius + geo.CLUSTER_GAP) ** 2, 0)
  const targetW = Math.max(
    2 * (clusters[0]?.radius ?? 200) + geo.CLUSTER_GAP,
    Math.sqrt(areaSum * Math.max(aspect, 0.5)),
  )
  let x = 0
  let y = 0
  let rowH = 0
  for (const c of clusters) {
    const d = 2 * c.radius + geo.CLUSTER_GAP
    if (x > 0 && x + d > targetW) {
      x = 0
      y += rowH
      rowH = 0
    }
    const cx = x + c.radius + geo.CLUSTER_GAP / 2
    const cy = y + c.radius + geo.CLUSTER_GAP / 2
    positions[c.id] = { x: cx, y: cy }
    ringSlots(cx, cy, c.members.length, geo).forEach((p, i) => {
      positions[c.members[i]] = p
    })
    x += d
    rowH = Math.max(rowH, d)
  }

  // Anyone with no hub at all goes in a tidy grid underneath.
  const slotGroups: string[][] = clusters.map((c) => c.members)
  const loose = orderMembers(peopleIds.filter((id) => !homeOf.has(id)), adj)
  slotGroups.push(loose)
  if (loose.length > 0) {
    const perRow = Math.max(1, Math.floor(targetW / geo.SLOT))
    const top = y + rowH + geo.CLUSTER_GAP
    loose.forEach((id, i) => {
      positions[id] = { x: (i % perRow) * geo.SLOT, y: top + Math.floor(i / perRow) * (geo.RING_STEP * 0.8) }
    })
  }

  // Untangle the connection lines by swapping people between slots. Capped so a
  // huge graph can't make this expensive.
  if (relEdges.length >= 2 && relEdges.length <= 120) reduceCrossings(positions, relEdges, slotGroups)

  const hulls = hullsFor(hubIds, (h) => (membersOf.get(h) ?? []).filter((p) => homeOf.get(p) === h), positions, geo)
  return { positions, hulls }
}

/**
 * An outline describes where a cluster actually *sits*, which is not always the
 * same as who belongs to it. In the clustered layout the two match, because
 * people in several groups are placed between them — so their outlines overlap,
 * and the overlap is the shared people. In rows, those people are drawn inside
 * whichever cluster claimed them, and wrapping the outline around a member two
 * rows away turns it into a sliver crossing the whole chart: noise, not
 * information. So each layout says which members its outlines should cover, and
 * the memberships an outline leaves out are still drawn as spokes.
 */
function hullsFor(
  hubIds: string[],
  drawnMembers: (hub: string) => string[],
  positions: Record<string, Pos>,
  geo: Geo,
): Hull[] {
  const hulls: Hull[] = []
  for (const h of hubIds) {
    const pts = [...drawnMembers(h), h].map((id) => positions[id]).filter(Boolean)
    if (pts.length === 0) continue
    hulls.push({ hubId: h, pts: hullFor(pts, geo.SLOT * 0.34) })
  }
  return hulls
}

/**
 * CLUSTERED. The hubs — a few dozen at most, never the people — are settled by
 * a small force simulation: they repel until their rings can't overlap, and
 * springs pull any two that share people until they touch. People who belong to
 * one hub ring it as usual; people who belong to several sit between them,
 * which is what makes a shared membership visible as closeness rather than as a
 * line going somewhere off-screen.
 *
 * Seeded, so the same graph always settles the same way and the chart doesn't
 * reshuffle itself on every render.
 */
export function clusteredLayout(els: cytoscape.ElementDefinition[], geo: Geo, aspect: number): Layout {
  const { hubIds, peopleIds, membersOf, hubsOf, adj, relEdges, shared } = readGraph(els)
  if (hubIds.length === 0) return rowsLayout(els, geo, aspect)

  let seed = 0x9e3779b9
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

  const radius = new Map(
    hubIds.map((h) => {
      const sole = (membersOf.get(h) ?? []).filter((p) => (hubsOf.get(p) ?? []).length === 1)
      return [h, clusterRadius(sole.length, geo)]
    }),
  )

  const P = hubIds.map((h, i) => {
    const a = (i / hubIds.length) * Math.PI * 2
    const spread = 240 + hubIds.length * 18
    return { id: h, x: Math.cos(a) * spread + rnd() * 8, y: Math.sin(a) * spread + rnd() * 8 }
  })
  const at = new Map(P.map((p) => [p.id, p]))

  // Amplifying the aspect error is the whole trick: mutually repelling discs
  // settle into a blob, and an unamplified bias tops out under 2x and never
  // flattens the packing at all. Higher trades cluster tightness for screen
  // fill; this sits where the chart beats the old layout on both.
  const GAIN = 25
  // Each pass costs O(hubs²), so a fixed budget that feels instant for a dozen
  // clusters locks the page up for eighty. Crowded packings also settle sooner,
  // so the budget shrinks as the hubs multiply — and the loop stops early once
  // nothing is really moving, which is the common case well before the cap.
  const iterations = Math.max(180, Math.min(900, Math.round(7200 / Math.max(hubIds.length, 1))))
  const prev = P.map((p) => ({ x: p.x, y: p.y }))
  // Shared-member counts don't change while the sim runs, and counting them per
  // pair per pass was costing more than every force put together.
  const springs: { a: (typeof P)[number]; b: (typeof P)[number]; w: number; rest: number }[] = []
  for (let i = 0; i < hubIds.length; i++)
    for (let j = i + 1; j < hubIds.length; j++) {
      const w = shared(hubIds[i], hubIds[j])
      if (!w) continue
      const a = at.get(hubIds[i])!
      const b = at.get(hubIds[j])!
      springs.push({
        a,
        b,
        w: Math.min(w, 4),
        rest: radius.get(a.id)! + radius.get(b.id)! + geo.CLUSTER_GAP,
      })
    }
  for (let it = 0; it < iterations; it++) {
    P.forEach((p, i) => {
      prev[i].x = p.x
      prev[i].y = p.y
    })
    const gx = P.reduce((s, p) => s + p.x, 0) / P.length
    const gy = P.reduce((s, p) => s + p.y, 0) / P.length
    // Measure the drawn extent, radii included — hub centres alone understate a
    // big cluster and the correction comes out far too weak.
    const bw = Math.max(...P.map((p) => p.x + radius.get(p.id)!)) - Math.min(...P.map((p) => p.x - radius.get(p.id)!)) || 1
    const bh = Math.max(...P.map((p) => p.y + radius.get(p.id)!)) - Math.min(...P.map((p) => p.y - radius.get(p.id)!)) || 1
    const err = bw / bh / aspect
    const gyBias = err < 1 ? 1 + GAIN * (1 / err - 1) : 1
    const gxBias = err > 1 ? 1 + GAIN * (err - 1) : 1
    for (const p of P) {
      p.x -= (p.x - gx) * 0.01 * gxBias
      p.y -= (p.y - gy) * 0.01 * gyBias
    }

    // Keep every pair of clusters clear of each other's rings.
    for (let i = 0; i < P.length; i++)
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i]
        const b = P[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const want = radius.get(a.id)! + radius.get(b.id)! + geo.CLUSTER_GAP
        if (d < want) {
          const push = (want - d) * 0.45
          dx /= d
          dy /= d
          a.x -= dx * push
          a.y -= dy * push
          b.x += dx * push
          b.y += dy * push
        }
      }

    // Springs resting at the touching distance, so a shared pair sits as close
    // as their rings allow; strength rises with the number of people shared.
    for (const s of springs) {
      const a = s.a
      const b = s.b
      let dx = b.x - a.x
      let dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const pull = (d - s.rest) * 0.09 * s.w
      dx /= d
      dy /= d
      a.x += dx * pull
      a.y += dy * pull
      b.x -= dx * pull
      b.y -= dy * pull
    }

    // Settled? Stop. Most graphs get here long before the iteration cap.
    let moved = 0
    for (let i = 0; i < P.length; i++) moved += Math.abs(P[i].x - prev[i].x) + Math.abs(P[i].y - prev[i].y)
    if (moved < 0.25 * P.length) break
  }

  const positions: Record<string, Pos> = {}
  for (const p of P) positions[p.id] = { x: p.x, y: p.y }

  // People in exactly one hub ring it, as before.
  for (const h of hubIds) {
    const sole = orderMembers(
      (membersOf.get(h) ?? []).filter((p) => (hubsOf.get(p) ?? []).length === 1),
      adj,
    )
    ringSlots(positions[h].x, positions[h].y, sole.length, geo).forEach((p, i) => {
      positions[sole[i]] = p
    })
  }

  // People in several sit at the middle of the hubs they belong to, packed in
  // concentric rings when a whole group of them shares the same memberships.
  const bridges = peopleIds.filter((p) => (hubsOf.get(p) ?? []).length > 1)
  const bySignature = new Map<string, string[]>()
  for (const p of bridges) {
    const key = [...(hubsOf.get(p) ?? [])].sort().join('|')
    bySignature.set(key, [...(bySignature.get(key) ?? []), p])
  }
  for (const [key, group] of bySignature) {
    const hs = key.split('|').filter((h) => positions[h])
    if (hs.length === 0) continue
    const cx = hs.reduce((s, h) => s + positions[h].x, 0) / hs.length
    const cy = hs.reduce((s, h) => s + positions[h].y, 0) / hs.length
    orderMembers(group, adj).forEach((p, i) => {
      // 1 at the middle, then rings of 6, 12, … around it.
      let idx = i
      let ring = 0
      let cap = 1
      while (idx >= cap) {
        idx -= cap
        ring++
        cap = ring * 6
      }
      const r = ring * geo.SLOT * 0.62
      const a = cap > 1 ? (idx / cap) * Math.PI * 2 + ring * 0.4 : 0
      positions[p] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    })
  }

  // Nudge anyone who landed on top of a cluster's rings out to its edge — and
  // keep them clear of each other while doing it. Two people pushed off the
  // same disc otherwise slide to the same point on its edge and draw as one.
  const MIN_APART = geo.SLOT * 0.72
  for (let pass = 0; pass < 14; pass++) {
    for (const p of bridges) {
      for (const h of hubIds) {
        const hp = positions[h]
        const rr = radius.get(h)! + geo.SLOT * 0.3
        const dx = positions[p].x - hp.x
        const dy = positions[p].y - hp.y
        const d = Math.hypot(dx, dy) || 0.01
        if (d < rr) positions[p] = { x: hp.x + (dx / d) * rr, y: hp.y + (dy / d) * rr }
      }
    }
    for (let i = 0; i < bridges.length; i++)
      for (let j = i + 1; j < bridges.length; j++) {
        const a = positions[bridges[i]]
        const b = positions[bridges[j]]
        let dx = b.x - a.x
        let dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d > MIN_APART) continue
        // Two people on the exact same point have no direction to separate
        // along, so shift one off the spot and let the next pass sort it out.
        if (d < 0.01) {
          positions[bridges[j]] = { x: b.x + MIN_APART * 0.5, y: b.y }
          continue
        }
        const push = (MIN_APART - d) / 2
        dx /= d
        dy /= d
        positions[bridges[i]] = { x: a.x - dx * push, y: a.y - dy * push }
        positions[bridges[j]] = { x: b.x + dx * push, y: b.y + dy * push }
      }
  }

  // Anyone with no hub at all goes in a row beneath everything else.
  const loose = orderMembers(peopleIds.filter((id) => !hubsOf.has(id)), adj)
  if (loose.length > 0) {
    const ys = Object.values(positions).map((p) => p.y)
    const xs = Object.values(positions).map((p) => p.x)
    const left = Math.min(...xs)
    const top = Math.max(...ys) + geo.CLUSTER_GAP + geo.RING_STEP
    const width = Math.max(...xs) - left || geo.SLOT
    const perRow = Math.max(1, Math.floor(width / geo.SLOT))
    loose.forEach((id, i) => {
      positions[id] = { x: left + (i % perRow) * geo.SLOT, y: top + Math.floor(i / perRow) * (geo.RING_STEP * 0.8) }
    })
  }

  if (relEdges.length >= 2 && relEdges.length <= 120) {
    const groups = hubIds.map((h) => (membersOf.get(h) ?? []).filter((p) => (hubsOf.get(p) ?? []).length === 1))
    reduceCrossings(positions, relEdges, groups)
  }

  const hulls = hullsFor(hubIds, (h) => membersOf.get(h) ?? [], positions, geo)
  return { positions, hulls }
}
