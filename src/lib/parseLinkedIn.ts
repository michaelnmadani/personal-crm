/**
 * Turn a block of text copied off a LinkedIn profile's Experience section into
 * draft work-history entries.
 *
 * The paste is messy but not arbitrary. Two things make it tractable:
 *
 *  - every visible line arrives twice, because LinkedIn renders a duplicate
 *    copy of each label for screen readers;
 *  - every role carries a date range, and the lines just above it are the role
 *    and the employer.
 *
 * So the parser anchors on date ranges and reads backwards, rather than trying
 * to recognise the shape of the whole block. Anything it can't place is simply
 * dropped — the caller shows the result for editing before it is saved, which
 * is the real safety net.
 */

export type WorkDraft = {
  company: string
  title: string | null
  start_year: number | null
  end_year: number | null
  is_current: boolean
  /** The period exactly as it appeared, so nothing from the paste is lost. */
  raw_period: string | null
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const YEAR = '\\d{4}'
const DASH = '[-–—]|to'
const ENDPOINT = `(?:(?:${MONTH})\\s+)?${YEAR}`
const PERIOD_RE = new RegExp(`^(${ENDPOINT})\\s*(?:${DASH})\\s*(${ENDPOINT}|present|current|now)$`, 'i')

/** Employment types and layout labels LinkedIn prints as their own lines. */
const NOISE_RE =
  /^(full[- ]time|part[- ]time|contract|internship|freelance|self[- ]employed|seasonal|apprenticeship|permanent|temporary|volunteer|experience|show all.*|…?see more|see less|·|hybrid|remote|on[- ]site)$/i

/** "6 yrs 2 mos", "1 yr", "11 mos" — a duration on its own says nothing useful. */
const DURATION_RE = /^\d+\s*(yrs?|years?|mos?|months?)(\s+\d+\s*(mos?|months?))?$/i

/** Strip LinkedIn's trailing "· 5 yrs 5 mos" and any employment type after a dot. */
const beforeDot = (s: string) => s.split('·')[0].trim()

const yearIn = (s: string) => {
  const m = s.match(/\d{4}/)
  return m ? Number(m[0]) : null
}

/** Does this line carry a date range, and if so what does it say? */
function readPeriod(line: string): { start: number | null; end: number | null; current: boolean } | null {
  const head = beforeDot(line)
  const m = head.match(PERIOD_RE)
  if (!m) return null
  const current = /present|current|now/i.test(m[2])
  return { start: yearIn(m[1]), end: current ? null : yearIn(m[2]), current }
}

/**
 * The alt text of a company logo — "Westpac logo". Copying the page as
 * markdown brings the images along, and their alt text reads just like a
 * company name, so it has to go before it is mistaken for one.
 */
const isLogoAlt = (line: string) => /^.{1,60}\slogo$/i.test(line)

function isNoise(line: string) {
  const bare = beforeDot(line)
  return (
    line.length === 0 ||
    NOISE_RE.test(bare) ||
    NOISE_RE.test(line) ||
    DURATION_RE.test(bare) ||
    isLogoAlt(bare) ||
    // A bullet from a role description, not a title or employer. (Markdown
    // list markers are handled in normalise, and mean something different.)
    /^[•–]\s/.test(line) ||
    line.length > 120
  )
}

/**
 * The heading of a grouped block — "Full-time · 6 yrs 2 mos", or just the
 * duration. It only appears when several roles are listed under one employer,
 * which is the one layout that names the company *above* the roles instead of
 * below them. Spotting it is what keeps that case the right way round.
 */
function isGroupHeading(line: string) {
  const parts = line.split('·').map((s) => s.trim())
  if (parts.length === 2) return NOISE_RE.test(parts[0]) && DURATION_RE.test(parts[1])
  return parts.length === 1 && DURATION_RE.test(parts[0])
}

type Line = {
  text: string
  /** Was this a markdown list item? In a grouped block that marks a job title. */
  bullet: boolean
}

/**
 * Reduce the paste to plain lines.
 *
 * Copying a LinkedIn page can land as markdown, which brings three things the
 * plain-text copy doesn't have: every label wrapped in a link, a logo image
 * before each employer, and a list marker on each role inside a grouped block.
 * The links and images are stripped; the marker is kept, because it is the one
 * signal that tells a role title apart from an employer name.
 */
function normalise(raw: string): Line[] {
  const out: Line[] = []
  for (const original of raw.split(/\r?\n/)) {
    const text = original
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // logo images: drop outright
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: keep the label
      .replace(/^\s*[*+]\s+/, '') // list marker, remembered below
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    // Collapse the screen-reader duplicates: LinkedIn repeats each label.
    if (out[out.length - 1]?.text === text) continue
    out.push({ text, bullet: /^\s*[*+]\s+/.test(original) })
  }
  return out
}

export function parseLinkedInExperience(raw: string): WorkDraft[] {
  const lines = normalise(raw)

  const drafts: WorkDraft[] = []
  // The employer of a grouped block: named once at the top, then each role
  // under it. Claimed here so the backward walk below doesn't mistake it for
  // a role title.
  let groupCompany: string | null = null
  const claimed = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    if (isGroupHeading(lines[i].text)) {
      const above = lines[i - 1]
      if (above && !readPeriod(above.text) && !isNoise(above.text)) {
        groupCompany = beforeDot(above.text)
        claimed.add(i - 1)
      }
      continue
    }

    const period = readPeriod(lines[i].text)
    if (!period) continue

    // Walk back over the lines that belong to this role. A list marker ends the
    // walk: inside a grouped block that line is the job title and the employer
    // is named once, above the whole group.
    const above: string[] = []
    let bulleted = false
    for (let j = i - 1; j >= 0 && above.length < 2; j--) {
      // The previous role, or the heading of this group — either way, a wall.
      if (readPeriod(lines[j].text) || isGroupHeading(lines[j].text)) break
      if (claimed.has(j) || isNoise(lines[j].text)) continue
      above.unshift(lines[j].text)
      if (lines[j].bullet) {
        bulleted = true
        break
      }
    }

    let company: string | null = null
    let title: string | null = null
    if (bulleted && groupCompany) {
      // A role inside a grouped block: its employer heads the group.
      title = above[above.length - 1]
      company = groupCompany
    } else if (above.length >= 2) {
      // Title then employer, LinkedIn's usual order.
      title = above[0]
      company = beforeDot(above[1])
      groupCompany = company
    } else if (above.length === 1) {
      // One line: inside a grouped block that's the role, and the employer is
      // the heading above it. Otherwise take it as the employer.
      if (groupCompany) {
        title = above[0]
        company = groupCompany
      } else {
        company = beforeDot(above[0])
      }
    }

    if (!company) continue
    drafts.push({
      company,
      title: title && title !== company ? title : null,
      start_year: period.start,
      end_year: period.end,
      is_current: period.current,
      raw_period: beforeDot(lines[i].text) || lines[i].text,
    })
  }

  return dropDuplicates(drafts)
}

/** Identity of an entry for duplicate purposes. */
export const workKey = (w: {
  company: string
  title?: string | null
  start_year?: number | null
  end_year?: number | null
}) => [w.company.trim().toLowerCase(), (w.title ?? '').trim().toLowerCase(), w.start_year ?? '', w.end_year ?? ''].join('|')

/** Drop repeats within one paste — LinkedIn lists some roles more than once. */
export function dropDuplicates(drafts: WorkDraft[]) {
  const seen = new Set<string>()
  return drafts.filter((d) => {
    const k = workKey(d)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
