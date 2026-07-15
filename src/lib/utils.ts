import { addDays, differenceInYears, format, formatDistanceToNowStrict } from 'date-fns'
import type { ContactOverview, Reminder } from './types'

export const fullName = (c: { first_name: string; last_name?: string | null; nickname?: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ')

export const initials = (c: { first_name: string; last_name?: string | null }) =>
  (c.first_name[0] ?? '') + (c.last_name?.[0] ?? '')

export const fmtDate = (d: string | Date) => format(new Date(d), 'MMM d, yyyy')
export const fmtDateTime = (d: string | Date) => format(new Date(d), 'MMM d, yyyy · h:mm a')
export const ago = (d: string | Date) => formatDistanceToNowStrict(new Date(d), { addSuffix: true })

/** "34" from an exact birthdate, "~34" from an approximate birth year. */
export function ageOf(birthdate: string | null, approxYear: number | null): string | null {
  if (birthdate) return String(differenceInYears(new Date(), new Date(birthdate + 'T00:00:00')))
  if (approxYear) return `~${new Date().getFullYear() - approxYear}`
  return null
}

/** Next occurrence (this year or next) of a recurring date like a birthday. */
export function nextOccurrence(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate())
  if (next < today) next.setFullYear(today.getFullYear() + 1)
  return next
}

export const daysUntil = (d: Date) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** A snoozed reminder is due at max(due_at, snoozed_until). */
export function effectiveDue(r: Reminder): Date {
  const due = new Date(r.due_at)
  if (r.snoozed_until) {
    const s = new Date(r.snoozed_until)
    if (s > due) return s
  }
  return due
}

export const isDueNow = (r: Reminder) => r.status === 'open' && effectiveDue(r) <= new Date()

/**
 * Days until this contact's keep-in-touch cadence is due.
 * Negative = overdue. null = no cadence set.
 */
export function kitDueInDays(c: ContactOverview): number | null {
  if (!c.keep_in_touch_days) return null
  const base = new Date(c.last_contacted ?? c.created_at)
  const due = addDays(base, c.keep_in_touch_days)
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000)
}

export const kitOverdue = (c: ContactOverview) => {
  const d = kitDueInDays(c)
  return d !== null && d <= 0
}

export function download(filename: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
