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
}: {
  /** A finished phrase — append it. */
  onFinal: (text: string) => void
  /** The phrase still being heard — show it, but it may change. */
  onInterim: (text: string) => void
  onListening?: (listening: boolean) => void
}) {
  const Ctor = recognitionCtor()
  const [usable, setUsable] = useState(() => Ctor !== null && speechStatus().works !== false)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const started = useRef(false)
  const watchdog = useRef<number | undefined>(undefined)

  useEffect(() => () => rec.current?.abort(), [])
  useEffect(() => onListening?.(listening), [listening, onListening])

  if (!Ctor) return null
  // Having just given up, say why once; on later visits it simply isn't there.
  if (!usable) return message ? <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p> : null

  const giveUp = (detail: string) => {
    saveStatus({ works: false, detail })
    setMessage(detail)
    setListening(false)
    setUsable(false)
  }

  const start = () => {
    setMessage(null)
    const r = new Ctor()
    r.lang = navigator.language || 'en-AU'
    r.continuous = true
    r.interimResults = true
    started.current = false

    const live = () => {
      if (started.current) return
      started.current = true
      window.clearTimeout(watchdog.current)
      saveStatus({ works: true, detail: 'Worked here last time it was used.' })
    }
    r.onstart = live
    r.onaudiostart = live
    r.onresult = (e) => {
      live()
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0]?.transcript ?? ''
        if (res.isFinal) onFinal(text.trim())
        else interim += text
      }
      onInterim(interim.trim())
    }
    r.onerror = (e) => {
      window.clearTimeout(watchdog.current)
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'network') {
        // Not a reason to hide the button — just no signal right now.
        setMessage('No connection — the talk button needs one. The keyboard’s mic key works offline.')
        return
      }
      giveUp(REASON[e.error] ?? `Speech recognition stopped with “${e.error}”.`)
    }
    r.onend = () => {
      window.clearTimeout(watchdog.current)
      onInterim('')
      setListening(false)
    }

    // The failure that can't be detected any other way: the API exists, start()
    // returns, and then nothing ever happens.
    watchdog.current = window.setTimeout(() => {
      if (started.current) return
      r.abort()
      giveUp('The talk button never started listening on this device. Use the keyboard’s mic key instead — it works here.')
    }, 4000)

    try {
      r.start()
      rec.current = r
      setListening(true)
    } catch (err) {
      window.clearTimeout(watchdog.current)
      giveUp(`Couldn’t start speech recognition: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const stop = () => {
    rec.current?.stop()
    setListening(false)
  }

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
      <span className="text-xs text-slate-500">{listening ? 'Listening — tap to stop' : 'Tap to talk'}</span>
      {message && <p className="text-xs text-amber-400 text-center max-w-xs">{message}</p>}
    </div>
  )
}
