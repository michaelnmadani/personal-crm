/**
 * Positions the user has dragged nodes to on the network graph. The computed
 * layout is deterministic, so anything saved here is an intentional override
 * and wins over the calculated slot until the layout is reset.
 */
const KEY = 'networkNodePositions'

/**
 * Bumped whenever the computed layout changes shape. A position dragged under
 * an older layout describes a picture that no longer exists — restoring it
 * would strand one node far from the cluster it belongs to, looking like a bug
 * rather than a preference — so those are dropped once and the chart says so,
 * instead of quietly losing the arrangement or quietly corrupting the new one.
 */
const LAYOUT_VERSION = 2

export type NodePos = { x: number; y: number }

export type LoadedPositions = {
  positions: Record<string, NodePos>
  /** True when saved positions were thrown away because the layout changed. */
  discarded: boolean
}

export function loadNodePositions(): LoadedPositions {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { positions: {}, discarded: false }
    const parsed = JSON.parse(raw) as unknown
    // Before versioning, the value was a bare id -> position record. Anything
    // in that shape predates the current layout by definition.
    const versioned =
      parsed && typeof parsed === 'object' && 'v' in (parsed as Record<string, unknown>)
        ? (parsed as { v: number; pos: Record<string, NodePos> })
        : null
    if (!versioned || versioned.v !== LAYOUT_VERSION) {
      localStorage.removeItem(KEY)
      // Only worth mentioning if there was actually an arrangement to lose.
      const had = versioned ? Object.keys(versioned.pos ?? {}).length > 0 : Object.keys(parsed ?? {}).length > 0
      return { positions: {}, discarded: had }
    }
    // Guard against a half-written or hand-edited value poisoning the layout.
    const out: Record<string, NodePos> = {}
    for (const [id, p] of Object.entries(versioned.pos ?? {})) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x, y: p.y }
    }
    return { positions: out, discarded: false }
  } catch {
    return { positions: {}, discarded: false }
  }
}

export function saveNodePositions(pos: Record<string, NodePos>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: LAYOUT_VERSION, pos }))
  } catch {
    /* storage full or blocked — the graph still works, it just won't persist */
  }
}

export function clearNodePositions() {
  localStorage.removeItem(KEY)
}
