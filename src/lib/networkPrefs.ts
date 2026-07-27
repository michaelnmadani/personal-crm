/**
 * Positions the user has dragged nodes to on the network graph. The computed
 * layout is deterministic, so anything saved here is an intentional override
 * and wins over the calculated slot until the layout is reset.
 */
const KEY = 'networkNodePositions'

export type NodePos = { x: number; y: number }

export function loadNodePositions(): Record<string, NodePos> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, NodePos>
    // Guard against a half-written or hand-edited value poisoning the layout.
    const out: Record<string, NodePos> = {}
    for (const [id, p] of Object.entries(parsed ?? {})) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x, y: p.y }
    }
    return out
  } catch {
    return {}
  }
}

export function saveNodePositions(pos: Record<string, NodePos>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pos))
  } catch {
    /* storage full or blocked — the graph still works, it just won't persist */
  }
}

export function clearNodePositions() {
  localStorage.removeItem(KEY)
}
