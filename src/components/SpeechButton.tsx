import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * The browser's own speech recognition, as a tap-to-talk button.
 *
 * This is the extra, not the main path. The keyboard's own mic key (Gboard on
 * Android, dictation on a Mac) works everywhere; this one depends on the
 * browser's speech service, which behaves differently on every platform and
 * can't be tested from outside a real device. So it is built to:
 *
 *  - ask for the microphone once, up front, rather than on every restart;
 *  - only keep restarting while the microphone actually opens, so a refused
 *    or pending permission can't turn into a storm of prompts;
 *  - use the plainest settings on Android, where live in-progress text and
 *    continuous mode are both known to misbehave, and switch to the plainest
 *    settings anywhere it hears speech but gets no words back;
 *  - log every event the speech service fires, so when it fails the log says
 *    why rather than leaving it to be guessed at.
 */

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string; message?: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

const STORE = 'speechStatus'
const LOG = 'speechLog'
const MODE = 'speechMode'

/** Stop on its own after this long with nothing heard. */
const QUIET_LIMIT_MS = 60_000

/** What the last attempt on this device found, for the diagnostic panel. */
export type SpeechStatus = { works: boolean | null; detail: string; at: string | null }

const isAndroid = () => /Android/i.test(navigator.userAgent)

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Live in-progress text, or only finished phrases. Android starts on the
 * latter; anywhere else is moved to it the first time speech is heard but no
 * words come back.
 */
function plainMode(): boolean {
  try {
    const saved = localStorage.getItem(MODE)
    if (saved) return saved === 'plain'
  } catch {
    /* fall through */
  }
  return isAndroid()
}

/** For the diagnostic panel. */
export function speechMode(): string {
  return plainMode() ? 'finished phrases only' : 'live words as you speak'
}

export function speechStatus():SpeechStatus & { present: boolean } {
  const present = recognitionCtor() !== null
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as SpeechStatus | null
    if (saved) return { ...saved, present }
  } catch {
    /* fall through */
  }
  return { works: null, detail: present ? 'Not tried yet on this device.' : 'This browser has no speech recognition.', at: null, present }
}

function saveStatus(s: Omit<SpeechStatus, 'at'>) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...s, at: new Date().toISOString() }))
  } catch {
    /* not essential */
  }
}

/** Forget everything learned on this device and start fresh. */
export function resetSpeechStatus() {
  try {
    localStorage.removeItem(STORE)
    localStorage.removeItem(MODE)
    localStorage.removeItem(LOG)
  } catch {
    /* not essential */
  }
}

/** The event log from the last time the button was used. */
export function speechLog(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG) ?? '[]')
    return Array.isArray(raw) ? raw.map(String) : []
  } catch {
    return []
  }
}

const REASON: Record<string, string> = {
  'not-allowed': 'Microphone permission was refused. Allow it in the browser’s site settings, or use the keyboard’s mic key.',
  'service-not-allowed': 'This browser won’t run speech recognition here. Use the keyboard’s mic key instead.',
  'audio-capture': 'No microphone could be opened — another app may be using it.',
  'language-not-supported': 'Speech recognition doesn’t support this language here.',
}

export function SpeechButton({
  onFinal,
  onInterim,
  onListening,
  control,
}: {
  /** A finished phrase — append it. */
  onFinal: (text: string) => void
  /** The phrase still being heard — show it, but it may change. */
  onInterim: (text: string) => void
  onListening?: (listening: boolean) => void
  /** Lets the page stop listening itself — when Save is tapped mid-sentence. */
  control?: { current: { stop: () => void } | null }
}) {
  const Ctor = recognitionCtor()
  const [usable, setUsable] = useState(() => Ctor !== null && speechStatus().works !== false)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  // What the person wants, as opposed to what the browser is doing: Chrome
  // ends sessions at pauses, and this is what says "start another".
  const wanted = useRef(false)
  const pending = useRef('')
  const lastCommitted = useRef('')
  const quiet = useRef<number | undefined>(undefined)
  const restart = useRef<number | undefined>(undefined)
  const heardNothing = useRef(0)
  const log = useRef<string[]>([])
  const t0 = useRef(0)

  // Report changes in listening, not every render: the page passes a fresh
  // callback each time, and repeating "listening" mid-stop would undo it.
  const reportListening = useRef(onListening)
  reportListening.current = onListening
  useEffect(() => reportListening.current?.(listening), [listening])

  useEffect(
    () => () => {
      wanted.current = false
      window.clearTimeout(quiet.current)
      window.clearTimeout(restart.current)
      rec.current?.abort()
    },
    [],
  )

  if (!Ctor) return null
  // Having just given up, say why once; on later visits it simply isn't there.
  if (!usable) return message ? <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p> : null

  const note = (event: string, detail = '') => {
    const line = `${((performance.now() - t0.current) / 1000).toFixed(1)}s ${event}${detail ? ` ${detail}` : ''}`
    log.current = [...log.current, line].slice(-80)
    try {
      localStorage.setItem(LOG, JSON.stringify(log.current))
    } catch {
      /* not essential */
    }
  }

  /**
   * Keep a phrase — once. Android sometimes reports the same one twice, and
   * a phrase kept as heard can come back polished ("call sarah" → "Call
   * Sarah."), so they're compared without case or punctuation.
   */
  const sameWords = (a: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const commit = (text: string) => {
    const t = text.trim()
    if (!t || sameWords(t) === sameWords(lastCommitted.current)) return
    lastCommitted.current = t
    note('kept', JSON.stringify(t))
    onFinal(t)
  }

  const finish = (why: string | null = null) => {
    wanted.current = false
    window.clearTimeout(quiet.current)
    window.clearTimeout(restart.current)
    if (pending.current) commit(pending.current)
    pending.current = ''
    onInterim('')
    setListening(false)
    if (why) {
      note('stopped', why)
      setMessage(why)
    }
  }

  const giveUp = (detail: string) => {
    saveStatus({ works: false, detail })
    finish(detail)
    setUsable(false)
  }

  /** A long silence ends it, so a forgotten mic doesn't listen all day. */
  const armQuiet = () => {
    window.clearTimeout(quiet.current)
    quiet.current = window.setTimeout(() => {
      rec.current?.stop()
      finish('Stopped after a minute of quiet. Tap to carry on.')
    }, QUIET_LIMIT_MS)
  }

  /** One recognition session; another follows when it ends, while wanted. */
  const session = () => {
    const plain = plainMode()
    const r = new Ctor()
    r.lang = navigator.language || 'en-AU'
    // Android ends every session at a pause anyway and, in continuous mode,
    // tends to repeat the whole transcript as each new phrase arrives.
    r.continuous = !isAndroid()
    r.interimResults = !plain
    let micOpened = false
    let heardSpeech = false
    let gotWords = false

    note('session', `continuous=${r.continuous} interim=${r.interimResults} lang=${r.lang}`)
    r.onstart = () => note('start')
    r.onaudiostart = () => {
      micOpened = true
      note('mic open')
    }
    r.onspeechstart = () => {
      heardSpeech = true
      micOpened = true
      note('speech heard')
    }
    r.onspeechend = () => note('speech ended')
    r.onresult = (e) => {
      armQuiet()
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0]?.transcript ?? ''
        if (text.trim()) gotWords = micOpened = true
        if (res.isFinal) {
          commit(text)
          pending.current = ''
        } else interim += text
      }
      pending.current = interim.trim()
      if (pending.current) note('hearing', JSON.stringify(pending.current))
      onInterim(pending.current)
      if (gotWords) {
        heardNothing.current = 0
        saveStatus({ works: true, detail: 'Worked here last time it was used.' })
      }
    }
    r.onerror = (e) => {
      note('error', `${e.error}${e.message ? ` (${e.message})` : ''}`)
      // Silence and our own stop() are routine — the session just ends and,
      // if still wanted, starts again. Reporting silence means it listened.
      if (e.error === 'no-speech') micOpened = true
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'network') {
        finish('No connection — the talk button needs one. The keyboard’s mic key works offline.')
        return
      }
      giveUp(REASON[e.error] ?? `Speech recognition stopped with “${e.error}”.`)
    }
    r.onend = () => {
      note('end')
      // The browser often ends a session without marking the last phrase
      // final. What it heard is still what was said — keep it.
      if (pending.current) {
        commit(pending.current)
        pending.current = ''
        onInterim('')
      }
      if (!wanted.current) {
        setListening(false)
        return
      }
      // The microphone never opened: whatever is wrong (a permission still
      // being asked for, another app holding the mic), restarting would only
      // ask again and again. Stop and say so.
      if (!micOpened) {
        finish('The microphone didn’t open. If a permission prompt appeared, allow it and tap again — or use the keyboard’s mic key.')
        return
      }
      // Speech was heard but no words came back. Once, drop to the plainest
      // settings and carry on; if even that returns nothing, this device's
      // speech service isn't delivering text, and the keyboard mic is the way.
      if (heardSpeech && !gotWords) {
        heardNothing.current++
        if (!plainMode()) {
          try {
            localStorage.setItem(MODE, 'plain')
          } catch {
            /* not essential */
          }
          note('switching', 'to finished-phrases-only mode')
        } else if (heardNothing.current >= 2) {
          giveUp('This device’s speech service heard you but returned no words. Use the keyboard’s mic key — it works here.')
          return
        }
      }
      restart.current = window.setTimeout(() => {
        if (wanted.current) session()
      }, 150)
    }

    try {
      r.start()
      rec.current = r
    } catch (err) {
      note('start failed', err instanceof Error ? err.message : String(err))
      finish(`Couldn’t start listening: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Ask for the microphone once, in its own step, before any recognition
   * starts — so the permission prompt appears once and its answer is known,
   * instead of each recognition session asking for itself.
   */
  const start = async () => {
    setMessage(null)
    t0.current = performance.now()
    log.current = []
    note('tap', `${isAndroid() ? 'android' : 'desktop'} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown browser'}`)
    wanted.current = true
    pending.current = ''
    lastCommitted.current = ''
    heardNothing.current = 0
    setListening(true)

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // Only the permission was wanted; hand the mic straight back so the
        // speech service can have it.
        stream.getTracks().forEach((t) => t.stop())
        note('mic permission', 'granted')
      } catch (err) {
        const name = err instanceof Error ? err.name : String(err)
        note('mic permission', name)
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          finish('Microphone access was refused. Allow it for this app in your settings, or use the keyboard’s mic key.')
          return
        }
        if (name === 'NotFoundError' || name === 'NotReadableError') {
          finish('No microphone could be opened — another app may be using it.')
          return
        }
      }
    }
    if (!wanted.current) return
    armQuiet()
    // Android can take a moment to release the mic just handed back.
    if (isAndroid()) {
      restart.current = window.setTimeout(() => {
        if (wanted.current) session()
      }, 300)
    } else session()
  }

  // stop(), not abort(): stop lets the browser hand over what it has heard,
  // and the session's own end keeps it. If that end never comes, keep the
  // words anyway after a moment rather than lose them.
  const stop = () => {
    if (!wanted.current && !listening) return
    note('stop tapped')
    wanted.current = false
    window.clearTimeout(quiet.current)
    window.clearTimeout(restart.current)
    setListening(false)
    const r = rec.current
    r?.stop()
    window.setTimeout(() => {
      if (rec.current === r && pending.current) {
        commit(pending.current)
        pending.current = ''
        onInterim('')
      }
    }, 1500)
  }

  if (control) control.current = { stop }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={listening ? stop : () => void start()}
        className={`w-20 h-20 rounded-full grid place-items-center transition-colors ${
          listening ? 'bg-red-600 text-white animate-pulse' : 'bg-indigo-600 text-white hover:bg-indigo-500'
        }`}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Start talking'}
      >
        <Icon name="mic" className="w-8 h-8" />
      </button>
      <span className="text-xs text-slate-500">
        {listening
          ? plainMode()
            ? 'Listening — each phrase appears when you pause. Tap to stop.'
            : 'Listening — pause as long as you like, tap to stop'
          : 'Tap to talk'}
      </span>
      {message && <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p>}
    </div>
  )
}
