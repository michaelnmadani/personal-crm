/**
 * Captures are written here first and sent from here, so nothing said into the
 * phone is lost to a dead connection — on a train, in a lift, in a basement
 * car park. An entry only leaves once the database has it.
 *
 * Each one carries an id made on the phone. If a send succeeds but the reply
 * never arrives, the retry carries the same id and the database ignores it
 * rather than storing the capture twice.
 *
 * localStorage rather than IndexedDB: these are a few lines of text each, and
 * it is synchronous, so a capture is safely stored before the save button has
 * finished being pressed.
 */
import { api } from './hooks'
import type { CaptureSource } from './types'

const KEY = 'captureOutbox'

export type OutboxEntry = {
  client_id: string
  raw_text: string
  source: CaptureSource
  captured_at: string
}

type Listener = (entries: OutboxEntry[]) => void
const listeners = new Set<Listener>()

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (e): e is OutboxEntry =>
            !!e && typeof e === 'object' && typeof (e as OutboxEntry).raw_text === 'string' && typeof (e as OutboxEntry).client_id === 'string',
        )
      : []
  } catch {
    return []
  }
}

function write(entries: OutboxEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* storage full or blocked — the in-memory copy still gets sent this session */
  }
  for (const l of listeners) l(entries)
}

/** Crypto ids where available (any secure context); a fallback for anywhere they aren't. */
function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function pendingCaptures(): OutboxEntry[] {
  return read()
}

export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Store a capture on the phone. Returns immediately; sending happens separately. */
export function queueCapture(raw_text: string, source: CaptureSource): OutboxEntry {
  const entry: OutboxEntry = {
    client_id: newId(),
    raw_text: raw_text.trim(),
    source,
    captured_at: new Date().toISOString(),
  }
  write([...read(), entry])
  return entry
}

export type FlushResult =
  | { status: 'sent'; count: number }
  | { status: 'empty' }
  | { status: 'offline'; waiting: number }
  /** The database refused outright (the read-only demo login) — retrying won't help. */
  | { status: 'refused'; message: string }

let inFlight: Promise<FlushResult> | null = null

/** Send everything waiting. Safe to call as often as you like; overlapping calls share one send. */
export function flushCaptures(): Promise<FlushResult> {
  if (inFlight) return inFlight
  inFlight = (async (): Promise<FlushResult> => {
    const batch = read()
    if (batch.length === 0) return { status: 'empty' }
    try {
      await api.addCaptureDrafts(batch)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // The read-only demo is refused by the database itself; keeping those
      // around to retry forever would only pile them up.
      if (/read-only demo/i.test(message)) {
        const sentIds = new Set(batch.map((b) => b.client_id))
        write(read().filter((e2) => !sentIds.has(e2.client_id)))
        return { status: 'refused', message }
      }
      return { status: 'offline', waiting: batch.length }
    }
    // Only drop what was actually in this batch — anything captured while it
    // was in flight stays queued for the next send.
    const sentIds = new Set(batch.map((b) => b.client_id))
    write(read().filter((e) => !sentIds.has(e.client_id)))
    return { status: 'sent', count: batch.length }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}
