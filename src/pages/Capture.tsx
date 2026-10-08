import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useCaptureDrafts } from '../lib/hooks'
import { flushCaptures, onOutboxChange, pendingCaptures, queueCapture, type OutboxEntry } from '../lib/captureOutbox'
import type { CaptureSource } from '../lib/types'
import { Icon } from '../components/Icon'
import { SpeechButton, resetSpeechStatus, speechStatus } from '../components/SpeechButton'
import { btnPrimary, card, input } from '../components/ui'

/** Unsent words survive leaving the page, a reload, or the app being closed. */
const DRAFT_KEY = 'captureDraftText'

/**
 * Say it, save it, move on. Nothing is worked out here — not who it's about,
 * not when — so saving is instant and works with no signal. Working it out
 * happens in the inbox, where it can be checked.
 */
export function Capture() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: waiting } = useCaptureDrafts()
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [outbox, setOutbox] = useState<OutboxEntry[]>(() => pendingCaptures())
  const [savedThisVisit, setSavedThisVisit] = useState<OutboxEntry[]>([])
  const source = useRef<CaptureSource>('typed')
  const speech = useRef<{ stop: () => void } | null>(null)
  // Set when Save is tapped mid-sentence: the browser may still hand back
  // the phrase it was hearing, and that belongs to the capture just saved,
  // not at the start of the next one.
  const ignoreLateSpeech = useRef(false)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => onOutboxChange(setOutbox), [])

  // Long dictation runs past the box's height; keep the newest words in view.
  useEffect(() => {
    if (listening && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text, listening])

  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text)
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* not essential */
    }
  }, [text])

  // Something shared in from another app — the Recorder's transcript, a note,
  // a message — arrives as ?title=&text=&url= via the share sheet.
  useEffect(() => {
    const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n').trim()
    if (!shared) return
    setText((t) => (t ? `${t}\n${shared}` : shared))
    source.current = 'shared'
    navigate('/capture', { replace: true })
  }, [params, navigate])

  const save = async () => {
    // Whatever is mid-phrase counts — Save shouldn't cost the last sentence.
    const words = [text.trim(), interim.trim()].filter(Boolean).join(' ')
    if (!words) return
    if (listening) {
      ignoreLateSpeech.current = true
      speech.current?.stop()
    }
    const entry = queueCapture(words, source.current)
    setSavedThisVisit((s) => [entry, ...s].slice(0, 5))
    setText('')
    setInterim('')
    source.current = 'typed'
    box.current?.focus()

    const r = await flushCaptures()
    if (r.status === 'sent') {
      await queryClient.invalidateQueries({ queryKey: ['captureDrafts'] })
      setStatus({ tone: 'ok', text: 'Saved to your inbox.' })
    } else if (r.status === 'offline') {
      setStatus({ tone: 'warn', text: 'Saved on this phone — it will send itself when you’re back online.' })
    } else if (r.status === 'refused') {
      setStatus({ tone: 'warn', text: r.message })
    }
  }

  const inInbox = (waiting ?? []).length

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Capture</h1>
        <Link to="/inbox" className="text-sm text-indigo-400 hover:underline">
          {inInbox > 0 ? `${inInbox} to review →` : 'Inbox →'}
        </Link>
      </header>

      <div className={`${card} p-4 space-y-3`}>
        <textarea
          ref={box}
          className={`${input} text-base leading-relaxed min-h-40`}
          rows={6}
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setStatus(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void save()
            }
          }}
          placeholder={'Say it the way you’d tell someone —\n“Had coffee with Sarah this morning, she’s moving to Sydney”\n“Remind me to call James on Friday about the contract”'}
          aria-label="What happened, or what to do"
        />

        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Icon name="mic" className="w-4 h-4 shrink-0 text-indigo-400" />
          <span>
            Tap the mic on your keyboard to dictate. On a Pixel it runs on the phone itself, so it works with no signal.
          </span>
        </p>

        {/* What's being heard right now, large enough to read at arm's
            length while talking. Each finished phrase moves up into the box. */}
        {listening && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5" aria-live="polite">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-400">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Hearing
            </p>
            <p className={`mt-1 text-base leading-relaxed ${interim ? 'text-slate-100' : 'text-slate-500'}`}>
              {interim || 'Go ahead — finished phrases appear in the box above.'}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center gap-3 pt-1">
          <SpeechButton
            control={speech}
            onListening={(on) => {
              setListening(on)
              if (on) ignoreLateSpeech.current = false
            }}
            onFinal={(phrase) => {
              if (!phrase || ignoreLateSpeech.current) return
              source.current = 'speech'
              setText((t) => (t.trim() ? `${t.trimEnd()} ${phrase}` : phrase))
              setStatus(null)
            }}
            onInterim={(t) => setInterim(ignoreLateSpeech.current ? '' : t)}
          />
          <button type="button" className={`${btnPrimary} w-full py-3 text-base`} onClick={save} disabled={!text.trim() && !interim.trim()}>
            <Icon name="check" className="w-5 h-5" /> Save
          </button>
        </div>

        {status && (
          <p className={`text-sm text-center ${status.tone === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`}>{status.text}</p>
        )}
      </div>

      {outbox.length > 0 && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500">
              Waiting to send ({outbox.length})
            </h2>
            <button className="text-xs text-indigo-400 hover:underline" onClick={() => void flushCaptures()}>
              Send now
            </button>
          </div>
          <ul className="space-y-1.5">
            {outbox.map((e) => (
              <li key={e.client_id} className="text-sm text-slate-300 line-clamp-2">
                {e.raw_text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-2">Kept safely on this phone until it can reach the server.</p>
        </div>
      )}

      {savedThisVisit.length > 0 && (
        <div className={`${card} p-4`}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Just saved</h2>
          <ul className="space-y-1.5">
            {savedThisVisit.map((e) => (
              <li key={e.client_id} className="text-sm text-slate-400 line-clamp-2">
                {e.raw_text}
              </li>
            ))}
          </ul>
          <Link to="/inbox" className="inline-block mt-3 text-sm text-indigo-400 hover:underline">
            Review them now →
          </Link>
        </div>
      )}

      <MicHelp />
    </div>
  )
}

/**
 * What to tell me if voice isn't working: everything that decides whether it
 * can, read off the phone itself rather than guessed at.
 */
function MicHelp() {
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState<string>('unknown')
  const [tick, setTick] = useState(0)
  const s = speechStatus()

  useEffect(() => {
    if (!open) return
    const perms = navigator.permissions as Permissions | undefined
    perms
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => setPermission(p.state))
      .catch(() => setPermission('not reported'))
  }, [open, tick])

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches

  return (
    <details className={`${card} p-4`} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-sm text-slate-400 cursor-pointer select-none">Voice not working?</summary>
      <div className="mt-3 space-y-3 text-sm text-slate-400">
        <p>
          The keyboard’s mic key always works: tap into the box above, then the microphone on Gboard. It doesn’t need this
          page to support anything.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Talk button available</dt>
          <dd>{s.present ? 'yes' : 'no — use the keyboard mic'}</dd>
          <dt className="text-slate-500">Last result here</dt>
          <dd>{s.works === null ? 'not tried yet' : s.works ? 'worked' : 'didn’t work'}</dd>
          <dt className="text-slate-500">Detail</dt>
          <dd>{s.detail}</dd>
          <dt className="text-slate-500">Microphone permission</dt>
          <dd>{permission}</dd>
          <dt className="text-slate-500">Running as installed app</dt>
          <dd>{standalone ? 'yes' : 'no (browser tab)'}</dd>
          <dt className="text-slate-500">Online</dt>
          <dd>{navigator.onLine ? 'yes' : 'no'}</dd>
        </dl>
        {s.works === false && (
          <button
            className="text-xs text-indigo-400 hover:underline"
            onClick={() => {
              resetSpeechStatus()
              setTick((n) => n + 1)
              window.location.reload()
            }}
          >
            Try the talk button again
          </button>
        )}
      </div>
    </details>
  )
}
