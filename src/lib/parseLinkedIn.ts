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

/** "Skills: Board Governance, +13 skills" — LinkedIn prints these under a role. */
const SKILLS_RE = /^skills?\s*[:·]/i

/** The glyph someone started a line of their own role description with. */
const DESC_BULLET_RE = /^[•■▪●○‣–—-]\s/

/** Strip LinkedIn's trailing "· 5 yrs 5 mos" and any employment type after a dot. */
export const beforeDot = (s: string) => s.split('·')[0].trim()

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
  return line.length === 0 || NOISE_RE.test(bare) || NOISE_RE.test(line) || DURATION_RE.test(bare) || isLogoAlt(bare)
}

/**
 * Is this a line of the *body* of an entry — the description, or the skills
 * listed under it — rather than one of the heading lines above its dates?
 *
 * This matters because the parser reads backwards from a date line, and the
 * lines it walks over on the way are the tail of the entry before. Body lines
 * are where one entry stops and the next begins, so the walk has to end at
 * them rather than step over them looking for an employer.
 */
function isRoleDetail(line: string) {
  return (
    SKILLS_RE.test(line) ||
    DESC_BULLET_RE.test(line) ||
    line.length > 120 ||
    // A sentence someone wrote about the job, not a title or an employer.
    (/[.!?]$/.test(line) && line.split(/\s+/).length >= 6)
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
export function normalise(raw: string): Line[] {
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

/**
 * "Sydney, New South Wales, Australia", "Greater Sydney Area" — where the job
 * was done. A place reads much like a company, and a job title can carry a
 * comma too, so this is only ever asked about a line sitting exactly where
 * LinkedIn puts the location. That position is what makes it safe to be loose.
 */
export function looksLikeLocation(line: string) {
  const s = beforeDot(line)
  if (s.length > 80 || /\d|&|:|\||\bat\b/i.test(s)) return false
  if (/^greater\b.*\barea$/i.test(s) || /\bmetropolitan area$/i.test(s)) return true
  const parts = s.split(',').map((p) => p.trim())
  return parts.length >= 2 && parts.length <= 4 && parts.every((p) => p.length >= 2 && p.length <= 40)
}

/** Is the line at `j` the location LinkedIn prints under an entry's dates? */
function isLocationLine(lines: Line[], j: number) {
  const prev = lines[j - 1]
  if (!prev || (!readPeriod(prev.text) && !isGroupHeading(prev.text))) return false
  return looksLikeLocation(lines[j].text)
}

export function parseLinkedInExperience(raw: string): WorkDraft[] {
  const lines = normalise(raw)

  const drafts: WorkDraft[] = []
  // The employer of a grouped block: named once at the top, then each role
  // under it. Claimed here so the backward walk below doesn't mistake it for
  // a role title.
  let groupCompany: string | null = null
  // Whether that employer was announced by a heading — meaning we are reading
  // roles listed under it — or is just the last employer seen.
  let groupFromHeading = false
  const claimed = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    if (isGroupHeading(lines[i].text)) {
      const above = lines[i - 1]
      if (above && !readPeriod(above.text) && !isNoise(above.text) && !isRoleDetail(above.text)) {
        groupCompany = beforeDot(above.text)
        groupFromHeading = true
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
      // The body of the entry above: everything before it belongs to that one.
      if (isRoleDetail(lines[j].text)) break
      // Inside a grouped block the line under the heading (or under the dates
      // of the role before) is a location, and the role above it is named by
      // the heading — so there is no employer to find here.
      if (above.length === 1 && groupFromHeading && isLocationLine(lines, j)) break
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
      // Title then employer, LinkedIn's usual order. An entry that names its
      // own employer is also how a grouped block ends.
      title = above[0]
      company = beforeDot(above[1])
      groupCompany = company
      groupFromHeading = false
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

export type ProfileDraft = {
  first_name: string
  last_name: string | null
  title: string | null
  company: string | null
  location: string | null
}

/** Chrome around the name/headline on a copied profile page — never the data itself. */
const PROFILE_CHROME_RE =
  /^(message|connect|follow|more|save|report|share profile|contact info|open to|pending|\d+(st|nd|rd|th)\+?(\s*degree)?( connection)?|\d[\d,]*\+?\s*(connections?|followers?))$/i

export const isProfileChrome = (line: string) =>
  PROFILE_CHROME_RE.test(beforeDot(line)) || /^view .*'s profile$/i.test(line)

/**
 * Turn a paste of a LinkedIn profile's header — name, headline, location — into
 * a draft for a new contact. Same idea as `parseLinkedInExperience`: best-effort,
 * anchored on what's reliably in a fixed position, with the caller (the contact
 * form itself) as the place anything wrong gets edited before it's saved.
 */
export function parseLinkedInProfile(raw: string): ProfileDraft | null {
  const lines = normalise(raw).map((l) => l.text).filter((l) => !isProfileChrome(l))
  if (lines.length === 0) return null

  const [first, ...rest] = lines[0].trim().split(/\s+/)
  if (!first) return null

  let title: string | null = null
  let company: string | null = null
  let next = 1
  if (lines[1]) {
    const headline = beforeDot(lines[1])
    const atMatch = headline.match(/^(.*?)\s+at\s+(.+)$/i)
    if (atMatch) {
      title = atMatch[1].trim()
      company = atMatch[2].trim()
    } else {
      title = headline.split('|')[0].trim() || null
    }
    next = 2
  }

  const location = lines[next] && looksLikeLocation(lines[next]) ? beforeDot(lines[next]) : null

  return {
    first_name: first,
    last_name: rest.join(' ') || null,
    title,
    company,
    location,
  }
}

export type SharedConnectionDraft = { name: string; headline: string | null }

/** "1st", "2nd", "3rd+", "3rd degree connection" — LinkedIn's badge for how close a connection is. */
const DEGREE_RE = /^\d+(st|nd|rd|th)\+?(\s*degree)?(\s*connection)?$/i

/** "Show all 14 mutual connections", or a bare "12 mutual connections" — a count, never a person. */
const MUTUAL_COUNT_RE = /mutual connections?/i

/**
 * LinkedIn's collapsed preview: a couple of named people plus a count of the
 * rest, e.g. "Con Prassopoulos, Brendan Manning & 12 other mutual connections".
 * Shown unless "Show all N mutual connections" was clicked before copying.
 */
const COLLAPSED_RE = /^(.+?)\s*&\s*\d+\s+other mutual connections?\.?$/i

/** A plausible "First Last" name shape — the fallback when nothing else anchors a line to a person. */
const NAME_SHAPE_RE = /^\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){1,3}$/u

/**
 * The "& N other mutual connections" tail can land split across two or three
 * physical lines — copying a narrow LinkedIn panel often wraps with a real
 * line break, not just a visual one. Try the line alone first, then joined
 * with what follows, before giving up on it.
 */
const collapsedMatchAt = (lines: string[], i: number) =>
  lines[i].match(COLLAPSED_RE) ??
  (lines[i + 1] !== undefined ? `${lines[i]} ${lines[i + 1]}`.match(COLLAPSED_RE) : null) ??
  (lines[i + 2] !== undefined ? `${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`.match(COLLAPSED_RE) : null)

/**
 * Turn a paste of LinkedIn's "shared connections" panel into candidate
 * people — same spirit as `parseLinkedInExperience`: anchor on what's
 * reliably in a fixed position, drop anything that can't be placed, and let
 * the review table (not this function) be where anything wrong gets fixed.
 *
 * The expanded list anchors on each person's degree badge (name above it,
 * headline below); the collapsed preview anchors on its "& N other mutual
 * connections" tail instead. If neither shows up anywhere — a plain list of
 * names with nothing else — fall back to lines that are simply name-shaped.
 */
export function parseSharedConnections(raw: string): SharedConnectionDraft[] {
  const lines = normalise(raw).map((l) => l.text)
  const results: SharedConnectionDraft[] = []

  for (let i = 0; i < lines.length; i++) {
    // A window starting on a chrome line ("Message") or a location line
    // ("Greater Sydney Area") must never be glued onto what follows it — both
    // routinely sit right before the real summary line in a real paste.
    const skipStart = isProfileChrome(lines[i]) || looksLikeLocation(lines[i])
    const collapsed = skipStart ? null : collapsedMatchAt(lines, i)
    if (collapsed) {
      for (const part of collapsed[1].split(',')) {
        const name = part.trim()
        if (name && !isProfileChrome(name)) results.push({ name, headline: null })
      }
      continue
    }

    if (!DEGREE_RE.test(lines[i])) continue
    const name = lines[i - 1]
    if (!name || isProfileChrome(name)) continue
    const next = lines[i + 1]
    const headline = next && !isProfileChrome(next) && !DEGREE_RE.test(next) && !COLLAPSED_RE.test(next) ? next : null
    results.push({ name, headline })
  }

  if (results.length === 0) {
    for (const line of lines) {
      if (isProfileChrome(line) || MUTUAL_COUNT_RE.test(line) || COLLAPSED_RE.test(line)) continue
      if (NAME_SHAPE_RE.test(line)) results.push({ name: line, headline: null })
    }
  }

  const seen = new Set<string>()
  return results.filter((r) => {
    const key = r.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
