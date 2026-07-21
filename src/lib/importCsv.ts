// Client-side LinkedIn / generic contacts CSV parsing + mapping to our schema.
import type { LabeledValue } from './types'

export type ImportRow = {
  first_name: string
  last_name: string | null
  company: string | null
  title: string | null
  linkedin_url: string | null
  emails: LabeledValue[]
  met_on: string | null
  how_we_met: string | null
}

/** Minimal RFC4180 CSV parser (quotes, commas, escaped ""). */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function parseDate(s: string): string | null {
  const t = (s || '').trim()
  // LinkedIn "21 Jul 2026"
  let m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(t)
  if (m && MONTHS[m[2]]) return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`
  // ISO or other Date-parseable
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export type ParseResult = {
  rows: ImportRow[]
  skipped: number
  columns: string[]
  stats: { withCompany: number; withEmail: number; withDate: number }
}

/**
 * Parse a contacts CSV. Recognizes LinkedIn's "Connections.csv" (with its
 * "Notes:" preamble) and generic exports with First/Last Name style headers.
 */
export function parseContactsCsv(text: string): ParseResult {
  const all = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ''))
  const headerIdx = all.findIndex(
    (r) => r.map((c) => c.toLowerCase().trim()).some((c) => c === 'first name' || c === 'firstname' || c === 'name'),
  )
  if (headerIdx === -1) return { rows: [], skipped: 0, columns: [], stats: { withCompany: 0, withEmail: 0, withDate: 0 } }

  const header = all[headerIdx].map((h) => h.toLowerCase().trim())
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h))
  const iFirst = find('first name', 'firstname', 'name')
  const iLast = find('last name', 'lastname')
  const iUrl = find('url', 'profile url', 'linkedin')
  const iEmail = find('email address', 'email', 'e-mail')
  const iCompany = find('company', 'organization', 'organisation')
  const iPosition = find('position', 'title', 'job title')
  const iConnected = find('connected on', 'connected', 'date')

  const rows: ImportRow[] = []
  let skipped = 0
  for (let i = headerIdx + 1; i < all.length; i++) {
    const r = all[i]
    const first = clean(r[iFirst])
    const last = iLast >= 0 ? clean(r[iLast]) : ''
    if (!first && !last) { skipped++; continue }
    const email = iEmail >= 0 ? clean(r[iEmail]) : ''
    rows.push({
      first_name: first || last,
      last_name: first ? last || null : null,
      company: iCompany >= 0 ? clean(r[iCompany]) || null : null,
      title: iPosition >= 0 ? clean(r[iPosition]) || null : null,
      linkedin_url: iUrl >= 0 ? clean(r[iUrl]) || null : null,
      emails: email ? [{ label: 'work', value: email }] : [],
      met_on: iConnected >= 0 ? parseDate(r[iConnected]) : null,
      how_we_met: iUrl >= 0 && header.includes('connected on') ? 'Connected on LinkedIn' : null,
    })
  }
  return {
    rows,
    skipped,
    columns: header,
    stats: {
      withCompany: rows.filter((r) => r.company).length,
      withEmail: rows.filter((r) => r.emails.length).length,
      withDate: rows.filter((r) => r.met_on).length,
    },
  }
}
