import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { Icon } from './Icon'
import { card } from './ui'

export type CalKind = 'birthday' | 'reminder' | 'event'

export type CalItem = {
  id: string
  kind: CalKind
  label: string
  date: Date
  contactId?: string
  detail?: string
  /** Initials of the person this is about, shown before the label in the grid. */
  initials?: string
}

/**
 * Chips carry their category in the tint and left border, but the *text* uses
 * the theme's own foreground token (slate-100). Only slate and indigo are
 * remapped per theme — pink and emerald keep Tailwind's defaults, so coloured
 * label text turned unreadable on the light-background themes (light, business,
 * forest). Using the theme foreground keeps every theme legible for free.
 */
const STYLE: Record<CalKind, { dot: string; chip: string; icon: string; name: string }> = {
  birthday: { dot: 'bg-pink-500', chip: 'bg-pink-500/20 border-l-2 border-pink-500 text-slate-100', icon: 'gift', name: 'Birthday' },
  reminder: { dot: 'bg-indigo-500', chip: 'bg-indigo-500/20 border-l-2 border-indigo-500 text-slate-100', icon: 'bell', name: 'Reminder' },
  event: { dot: 'bg-emerald-500', chip: 'bg-emerald-500/20 border-l-2 border-emerald-500 text-slate-100', icon: 'calendar', name: 'Event' },
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Month grid of everything coming up — birthdays, reminders and events on one
 * calendar. The parent supplies items for whatever range is on screen, so
 * recurring things (birthdays) can be projected into the month being viewed.
 */
export function CalendarMonth({ itemsFor }: { itemsFor: (start: Date, end: Date) => CalItem[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [picked, setPicked] = useState<Date | null>(null)
  const [hover, setHover] = useState<{ item: CalItem; top: number; left: number } | null>(null)

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd])

  const items = useMemo(() => itemsFor(gridStart, gridEnd), [itemsFor, gridStart, gridEnd])
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>()
    for (const it of items) {
      const k = format(it.date, 'yyyy-MM-dd')
      m.set(k, [...(m.get(k) ?? []), it])
    }
    return m
  }, [items])

  const dayItems = (d: Date) => byDay.get(format(d, 'yyyy-MM-dd')) ?? []

  /** Position the hover card under the chip, clamped inside the viewport.
   *  Fixed positioning keeps it clear of each cell's overflow-hidden. */
  const showTip = (item: CalItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setHover({
      item,
      top: Math.min(r.bottom + 6, window.innerHeight - 130),
      left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
    })
  }
  const pickedItems = picked ? dayItems(picked) : []

  return (
    <section className={`${card} p-4`}>
      <header className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Icon name="calendar" className="w-4 h-4 text-indigo-400" />
          {format(month, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
          >
            <Icon name="back" className="w-4 h-4" />
          </button>
          <button
            className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:bg-slate-800"
            onClick={() => {
              setMonth(startOfMonth(new Date()))
              setPicked(null)
            }}
          >
            Today
          </button>
          <button
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 rotate-180"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
          >
            <Icon name="back" className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-[0.6875rem] font-medium text-slate-400 mb-1">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const list = dayItems(d)
          const outside = !isSameMonth(d, month)
          const isPicked = picked && isSameDay(d, picked)
          const today = isToday(d)
          return (
            <button
              key={d.toISOString()}
              onClick={() => setPicked(isPicked ? null : d)}
              className={`min-h-16 lg:min-h-32 flex flex-col items-stretch rounded-lg border p-1 text-left overflow-hidden transition-colors ${
                today
                  ? 'border-indigo-500 bg-indigo-500/30'
                  : isPicked
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-800 hover:border-slate-600'
              } ${outside ? 'opacity-40' : ''}`}
            >
              <span className={`block text-xs font-bold leading-none ${today ? 'text-slate-100' : 'text-slate-300'}`}>
                {format(d, 'd')}
              </span>
              {/* Details wrap onto as many lines as they need rather than being
                  truncated — there's vertical room for it on desktop. */}
              <span className="mt-0.5 block space-y-0.5">
                {list.slice(0, 4).map((it) => (
                  <span
                    key={it.id}
                    onMouseEnter={(e) => showTip(it, e.currentTarget)}
                    onMouseLeave={() => setHover(null)}
                    className={`block rounded px-1 py-0.5 text-[0.625rem] leading-tight break-words ${STYLE[it.kind].chip}`}
                  >
                    {it.initials && <span className="font-bold">{it.initials} </span>}
                    {it.label}
                  </span>
                ))}
                {list.length > 4 && <span className="block text-[0.625rem] text-slate-400">+{list.length - 4} more</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-3 text-[0.6875rem] text-slate-400">
        {(Object.keys(STYLE) as CalKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${STYLE[k].dot}`} />
            {STYLE[k].name}
          </span>
        ))}
      </div>

      {hover && (
        <div
          className={`${card} fixed z-50 w-64 p-3 shadow-xl pointer-events-none`}
          style={{ top: hover.top, left: hover.left }}
          role="tooltip"
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon name={STYLE[hover.item.kind].icon} className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-slate-400">
              {STYLE[hover.item.kind].name}
            </span>
            {hover.item.kind !== 'birthday' && (
              <span className="ml-auto text-[0.625rem] text-slate-400">{format(hover.item.date, 'h:mm a')}</span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-100 break-words">{hover.item.label}</p>
          {hover.item.detail && <p className="text-xs text-slate-400 break-words mt-0.5">{hover.item.detail}</p>}
          <p className="text-[0.625rem] text-slate-400 mt-1.5">{format(hover.item.date, 'EEEE, MMMM d')}</p>
        </div>
      )}

      {picked && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="text-xs font-semibold text-slate-300 mb-2">{format(picked, 'EEEE, MMMM d')}</p>
          {pickedItems.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing on this day.</p>
          ) : (
            <ul className="space-y-1.5">
              {pickedItems.map((it) => (
                <li key={it.id} className="flex items-center gap-2 text-sm">
                  <span className={`px-1.5 py-0.5 rounded text-[0.625rem] ${STYLE[it.kind].chip}`}>{STYLE[it.kind].name}</span>
                  {it.contactId ? (
                    <Link to={`/contacts/${it.contactId}`} className="text-slate-100 hover:text-indigo-300">
                      {it.label}
                    </Link>
                  ) : (
                    <span className="text-slate-100">{it.label}</span>
                  )}
                  {it.detail && <span className="text-xs text-slate-400">· {it.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
