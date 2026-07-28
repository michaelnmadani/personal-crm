import { useEffect, useState } from 'react'

/** The device's local calendar day as yyyy-MM-dd. */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The device's current day, kept fresh.
 *
 * Everything that asks "what is today" reads the device clock, but nothing
 * re-renders on its own when the clock rolls past midnight. A page left open —
 * a phone's home-screen app, the desktop app, a tab parked overnight — keeps
 * showing the day it was opened on, which reads as the calendar being a day
 * behind. Components that care about today call this so they redraw when the
 * day actually changes.
 */
export function useToday() {
  const [day, setDay] = useState(localDay)

  useEffect(() => {
    let timer = 0
    const check = () => {
      setDay((prev) => {
        const now = localDay()
        return prev === now ? prev : now
      })
      // Re-arm for a second past the next local midnight. Scheduling against
      // the real clock rather than a fixed interval means a daylight-saving
      // shift can't leave the next check an hour out.
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
      timer = window.setTimeout(check, Math.max(1000, next.getTime() - now.getTime()))
    }
    check()

    // A sleeping device doesn't fire timers, so also check whenever the app
    // comes back to the foreground — that's when a stale day is most visible.
    const onWake = () => {
      window.clearTimeout(timer)
      check()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [])

  return day
}
