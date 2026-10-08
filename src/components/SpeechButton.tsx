import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * The browser's own speech recognition, as a tap-to-talk button.
 *
 * This is the extra, not the main path. The keyboard's own mic key works
 * everywhere and on a Pixel runs on the phone itself, offline; this one sends
 * audio to Google and needs a connection. It's offered because it's one tap
 * fewer, not because it's better.
 *
 * Whether it works can't be known by looking: on some phones the API is
 * present and simply never starts. So the first press is the test. If nothing
 * starts within a few seconds — or the browser refuses outright — the button
 * hides itself for good on this device and says why, rather than sitting there
 * looking broken.
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
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

const STORE = 'speechStatus'

/** Stop on its own after this long with nothing heard. */
const QUIET_LIMIT_MS = 60_000

/** What the last attempt on this device found, for the diagnostic panel. */
export type SpeechStatus = { works: boolean | null; detail: string; at: string | null }

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechStatus(): SpeechStatus & { present: boolean } {
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

export function resetSpeechStatus() {
  try {
    localStorage.removeItem(STORE)
  } catch {
    /* not essential */
  }
}

const REASON: Record<string, string> = {
  'not-allowed': 'Microphone permission was refused. Allow it in the browser’s site settings, or use the keyboard’s mic key.',
  'service-not-allowed': 'This browser won’t run speech recognition inside an installed app.',
  'audio-capture': 'No microphone could be opened.',
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
  // ends a session at every pause, and this is what says "start another".
  const wanted = useRef(false)
  const heardAnything = useRef(false)
  const pending = useRef('')
  const lastCommitted = useRef('')
  const watchdog = useRef<number | undefined>(undefined)
  const quiet = useRef<number | undefined>(undefined)
  const restart = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      wanted.current = false
      window.clearTimeout(watchdog.current)
      window.clearTimeout(quiet.current)
      window.clearTimeout(restart.current)
      rec.current?.abort()
    },
    [],
  )
  // Report changes in listening, not every render: the page passes a fresh
  // callback each time, and repeating "listening" mid-stop would undo it.
  const reportListening = useRef(onListening)
  reportListening.current = onListening
  useEffect(() => reportListening.current?.(listening), [listening])

  if (!Ctor) return null
  // Having just given up, say why once; on later visits it simply isn't there.
  if (!usable) return message ? <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p> : null

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
    onFinal(t)
  }

  const finish = (note: string | null = null) => {
    wanted.current = false
    window.clearTimeout(watchdog.current)
    window.clearTimeout(quiet.current)
    window.clearTimeout(restart.current)
    if (pending.current) commit(pending.current)
    pending.current = ''
    onInterim('')
    setListening(false)
    if (note) setMessage(note)
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

  /**
   * One recognition session. Chrome on Android ends these at the first pause
   * whatever it's asked, so they're kept short on purpose (one phrase each)
   * and chained — which also sidesteps Android's habit, in continuous mode, of
   * reporting the whole transcript over again as each new phrase.
   */
  const session = (first: boolean) => {
    const r = new Ctor()
    r.lang = navigator.language || 'en-AU'
    r.continuous = false
    r.interimResults = true
    let started = false

    const live = () => {
      if (started) return
      started = true
      window.clearTimeout(watchdog.current)
      if (!heardAnything.current) {
        heardAnything.current = true
        saveStatus({ works: true, detail: 'Worked here last time it was used.' })
      }
    }
    r.onstart = live
    r.onaudiostart = live
    r.onresult = (e) => {
      live()
      armQuiet()
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0]?.transcript ?? ''
        if (res.isFinal) {
          commit(text)
          pending.current = ''
        } else interim += text
      }
      pending.current = interim.trim()
      onInterim(pending.current)
    }
    r.onerror = (e) => {
      // Silence and our own stop() are routine — the session just ends and,
      // if still wanted, starts again.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'network') {
        finish('No connection — the talk button needs one. The keyboard’s mic key works offline.')
        return
      }
      giveUp(REASON[e.error] ?? `Speech recognition stopped with “${e.error}”.`)
    }
    r.onend = () => {
      // The browser often ends a session without ever marking the last phrase
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
      // Still wanted: listen again. A short gap, because restarting inside
      // onend can fail on some builds.
      restart.current = window.setTimeout(() => {
        if (wanted.current) session(false)
      }, 120)
    }

    // The failure that can't be detected any other way: the API exists, start()
    // returns, and then nothing ever happens. Only judged on the very first
    // start — once it has worked, a slow restart is just a slow restart.
    if (first && !heardAnything.current) {
      watchdog.current = window.setTimeout(() => {
        if (started) return
        r.abort()
        giveUp('The talk button never started listening on this device. Use the keyboard’s mic key instead — it works here.')
      }, 4000)
    }

    try {
      r.start()
      rec.current = r
    } catch (err) {
      if (first) giveUp(`Couldn’t start speech recognition: ${err instanceof Error ? err.message : String(err)}`)
      else if (wanted.current) restart.current = window.setTimeout(() => wanted.current && session(false), 400)
    }
  }

  const start = () => {
    setMessage(null)
    wanted.current = true
    pending.current = ''
    lastCommitted.current = ''
    setListening(true)
    armQuiet()
    session(true)
  }

  // stop(), not abort(): stop lets the browser hand over what it has heard,
  // and the session's own end keeps it. If that end never comes, keep the
  // words anyway after a moment rather than lose them.
  const stop = () => {
    if (!wanted.current && !listening) return
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
        onClick={listening ? stop : start}
        className={`w-20 h-20 rounded-full grid place-items-center transition-colors ${
          listening ? 'bg-red-600 text-white animate-pulse' : 'bg-indigo-600 text-white hover:bg-indigo-500'
        }`}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Start talking'}
      >
        <Icon name="mic" className="w-8 h-8" />
      </button>
      <span className="text-xs text-slate-500">{listening ? 'Listening — pause as long as you like, tap to stop' : 'Tap to talk'}</span>
      {message && <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p>}
    </div>
  )
}
