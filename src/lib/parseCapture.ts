/**
 * Turn a dictated sentence into a draft: who it's about, when, and whether it
 * is something that happened (a timeline entry) or something to do (a
 * reminder). Pure — no React, no Supabase — so it can be checked on its own.
 *
 * Nothing here has to be right every time. Every result goes through a review
 * screen before it touches the database, which is what lets this be plain
 * rules plus fuzzy matching rather than a paid language model: the parser only
 * has to be right often enough to save typing, and honest about when it isn't
 * sure, so the review screen knows what to point at.
 */
import * as chrono from 'chrono-node'
import type { InteractionKind } from './types'

// ---------------------------------------------------------------- inputs

export type NameSource = {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
  last_contacted?: string | null
  favorite?: boolean
}

export type AliasSource = { heard: string; contact_id: string; last_used_at: string }

// ---------------------------------------------------------------- outputs

export type Confidence = 'high' | 'medium' | 'low'
type Via = 'full' | 'first' | 'last' | 'nick' | 'alias'

/** score ranks (it carries how the name was matched); match is the raw closeness, 1 = exact. */
export type Candidate = { contactId: string; score: number; match: number; via: Via }

/** A stretch of the sentence that looks like somebody's name. */
export type Mention = {
  start: number
  end: number
  heard: string
  /** Best first. The first one is the guess; the rest are offered as alternatives. */
  candidates: Candidate[]
  confidence: Confidence
}

export type Span = { start: number; end: number }

/**
 * How a date was arrived at, so the review screen can say which ones were
 * actually heard and which were filled in:
 *  - spoken      a day and a time were both said
 *  - spoken-day  a day was said; the time is a sensible default
 *  - captured    nothing was said; a timeline entry is dated when you said it
 *  - assumed     nothing was said; a reminder defaults to tomorrow morning
 */
export type WhenSource = 'spoken' | 'spoken-day' | 'captured' | 'assumed'

export type ParsedReminder = {
  title: string
  due: Date
  whenSource: WhenSource
  contactId: string | null
}

export type ParsedCapture = {
  kind: InteractionKind | 'reminder'
  /** False when nothing in the wording said which it was. */
  kindConfident: boolean
  when: Date
  whenSource: WhenSource
  title: string | null
  notes: string | null
  /** Every name heard, in the order said. */
  mentions: Mention[]
  /** The people the main item is about: the top guess from each mention. */
  contactIds: string[]
  dateSpans: Span[]
  /** Further things to do said in the same breath ("…and remind me to…"). */
  followUps: ParsedReminder[]
}

// ---------------------------------------------------------------- text helpers

/** Lowercase, accents off, apostrophes and hyphens dropped: "O'Gilt" → "ogilt". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`-]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const joined = (s: string) => normalizeName(s).replace(/ /g, '')

/**
 * A rough sound-alike key. Dictation keeps the consonants of a name far more
 * reliably than its vowels — "Wangnoo" comes back as "Wang new", "Akanksha" as
 * "Akansha" — so this keeps the first letter, folds letters that sound alike,
 * and drops the vowels after it.
 */
export function soundKey(s: string): string {
  let w = joined(s)
  if (!w) return ''
  w = w
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^ps/, 's')
    .replace(/mb$/, 'm')
    .replace(/tch/g, 'ch')
    .replace(/(sh|ch|sch)/g, 'X')
    .replace(/ph/g, 'f')
    .replace(/(ck|cq)/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/dg/g, 'j')
    .replace(/wh/g, 'w')
    .replace(/th/g, 't')
    .replace(/(?!^)gh/g, '')
    .replace(/v/g, 'f')
    .replace(/y/g, 'i')
  const first = /[aeiou]/.test(w[0]) ? 'a' : w[0]
  const rest = w
    .slice(1)
    .replace(/[aeiou]/g, '')
    .replace(/h/g, '')
    .replace(/w(?![aeiou])/g, '')
  return (first + rest).replace(/(.)\1+/g, '$1')
}

/** Jaro-Winkler similarity, 0–1. Rewards a shared beginning, which names usually keep. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 || lb === 0) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aHit = new Array<boolean>(la).fill(false)
  const bHit = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, lb)
    for (let j = lo; j < hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue
      aHit[i] = true
      bHit[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < la; i++) {
    if (!aHit[i]) continue
    while (!bHit[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3
  let prefix = 0
  while (prefix < Math.min(4, la, lb) && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

// ---------------------------------------------------------------- word lists

/** Words that can never start or end someone's name. */
const FILLER = new Set(
  (
    'the a an and or but nor to with for from at on in into of about my our your his her their me him them us ' +
    'i we you he she they it its this that these those is was were be been am are had have has do did does ' +
    'not no yes up out off over by as if so than then just also too very really re regarding some any all both ' +
    'again back here there when where while who what which how'
  ).split(' '),
)

/**
 * Ordinary words that are also some people's names (May, June, Mark, Will,
 * Grace…). On their own they only count as a name straight after a word that
 * points at a person — "lunch with May" yes, "meeting in May" no.
 */
const COMMON = new Set(
  (
    'january february march april may june july august september october november december ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun ' +
    'today tomorrow yesterday tonight morning afternoon evening night week weekend month year day time ' +
    'next last first second third new old big small good great best little long early late soon now later ' +
    'mark will bill grace hope rose joy faith dawn summer autumn winter spring sky river stone black white ' +
    'brown green gray grey gold silver red blue rich frank sterling pat bob sue chase hunter page penny ' +
    'jet turbo rebel duck drake general gene randy johnny storm wolf fox bird swift baker cook miller ' +
    'call email text message meet meeting coffee lunch dinner breakfast drinks chat note task remind ' +
    'send book check ask follow catch work home office job deal plan idea team project client boss ' +
    'kids kid wife husband partner son daughter mum mom dad family friend friends people person guy ' +
    'thing things stuff about deck slides report contract proposal invoice photos pics gift present card'
  ).split(' '),
)

/** A word directly before a name that makes it a person, not a thing or a date. */
const PERSON_CUES = new Set(
  (
    'with to call called calling ring rang phone phoned met meet meeting email emailed text texted message ' +
    'messaged tell told ask asked from see saw visit visited thank thanked invite invited introduce ' +
    'introduced wish congratulate cc ping pinged and'
  ).split(' '),
)

/** A bare month only counts as a date after one of these: "in May", "until June". */
const MONTH_LEAD = new Set('in during since until till by of early late mid end start beginning throughout before after'.split(' '))
const MONTH_WORD =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i

const VIA_WEIGHT: Record<Via, number> = { alias: 1, full: 1, nick: 0.97, first: 0.95, last: 0.93 }

// ---------------------------------------------------------------- name index

type Variant = {
  contactId: string
  via: Via
  key: string
  sound: string
  words: string[]
  /** Every word of it is an ordinary word too — so it needs a person cue. */
  common: boolean
}

export type NameIndex = {
  /** Variants filed under the first letter of the name and of its sound key. */
  byInitial: Map<string, Variant[]>
  /** Tie-break among equally good matches: favourites, then people seen lately. */
  prior: Map<string, number>
  size: number
}

/** Titles and post-nominals that sit inside a stored name but are never said. */
const NAME_NOISE = /^(dr|mr|mrs|ms|miss|mx|prof|sir|dame|rev|hon)$/i

function cleanStoredName(s: string | null): string {
  if (!s) return ''
  return s
    .split(/\s+/)
    .filter((w) => w && !NAME_NOISE.test(w.replace(/\./g, '')) && !(w.length >= 3 && /^[A-Z]{3,}$/.test(w)))
    .join(' ')
}

/** Build once per contact list; reuse for every draft. */
export function buildNameIndex(contacts: NameSource[], aliases: AliasSource[] = []): NameIndex {
  const byInitial = new Map<string, Variant[]>()
  const prior = new Map<string, number>()
  const now = Date.now()
  let size = 0

  const file = (contactId: string, via: Via, text: string) => {
    const key = joined(text)
    if (key.length < 2) return
    const words = normalizeName(text).split(' ')
    const v: Variant = { contactId, via, key, sound: soundKey(text), words, common: words.every((w) => COMMON.has(w)) }
    const initials = new Set([key[0], v.sound[0]])
    for (const i of initials) {
      const list = byInitial.get(i) ?? []
      list.push(v)
      byInitial.set(i, list)
    }
    size++
  }

  for (const c of contacts) {
    const first = cleanStoredName(c.first_name)
    const last = cleanStoredName(c.last_name)
    const nick = cleanStoredName(c.nickname)
    if (first && last) file(c.id, 'full', `${first} ${last}`)
    if (first) file(c.id, 'first', first)
    if (last) file(c.id, 'last', last)
    if (nick) {
      file(c.id, 'nick', nick)
      if (last) file(c.id, 'nick', `${nick} ${last}`)
    }
    const days = c.last_contacted ? (now - new Date(c.last_contacted).getTime()) / 86_400_000 : Infinity
    prior.set(c.id, (c.favorite ? 0.012 : 0) + (Number.isFinite(days) ? 0.02 * Math.exp(-days / 60) : 0))
  }
  // Newest alias first, so when one mishearing has meant two people over time
  // the more recent correction wins the tie.
  for (const a of [...aliases].sort((x, y) => y.last_used_at.localeCompare(x.last_used_at))) {
    if (prior.has(a.contact_id)) file(a.contact_id, 'alias', a.heard)
  }
  return { byInitial, prior, size }
}

/** How well a heard stretch of words matches one stored name variant. */
function matchScore(heardKey: string, heardSound: string, heardWords: string[], v: Variant): number {
  if (heardKey === v.key) return 1
  // Said in as many words as the name has, every word has to resemble its
  // counterpart. Matching on the run of letters alone let a shared opening
  // word carry it — "black tie" came out as Black Heron.
  if (heardWords.length > 1 && heardWords.length === v.words.length) {
    for (let k = 0; k < heardWords.length; k++) {
      const a = heardWords[k]
      const b = v.words[k]
      if (a !== b && jaroWinkler(a, b) < 0.8 && soundKey(a) !== soundKey(b)) return 0
    }
  }
  const shorter = Math.min(heardKey.length, v.key.length)
  const longer = Math.max(heardKey.length, v.key.length)
  if (shorter < 3 || shorter / longer < 0.6) return 0
  const spelled = jaroWinkler(heardKey, v.key)
  const sounded = heardSound && v.sound ? jaroWinkler(heardSound, v.sound) : 0
  // Same sound key is strong evidence on its own; a merely similar one is a
  // little weaker than the same similarity in spelling.
  const bySound = heardSound === v.sound && heardSound.length >= 3 ? 0.96 : sounded * 0.96
  return Math.max(spelled, bySound)
}

// ---------------------------------------------------------------- tokens

type Tok = { raw: string; norm: string; start: number; end: number }

function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const raw = m[0]
    out.push({ raw, norm: joined(raw), start: m.index!, end: m.index! + raw.length })
  }
  return out
}

// ---------------------------------------------------------------- dates

/**
 * Chrono doesn't read a bare "the 3rd" ("send it by the 3rd"), which is how a
 * deadline usually gets said. Taken to mean the next one.
 */
const dayOfMonth: chrono.Parser = {
  pattern: () => /\b(?:on|by|before|for|until)?\s*the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)/i,
  extract: (context, match) => {
    const day = Number(match[1])
    if (day < 1 || day > 31) return null
    const ref = context.reference.instant
    let month = ref.getMonth()
    let year = ref.getFullYear()
    if (day < ref.getDate()) {
      month += 1
      if (month > 11) {
        month = 0
        year += 1
      }
    }
    return context.createParsingComponents({ day, month: month + 1, year })
  },
}

const dateParser = (() => {
  const p = chrono.en.GB.clone()
  p.parsers.push(dayOfMonth)
  return p
})()

type DateHit = { start: number; end: number; result: chrono.ParsedResult }

function findDates(text: string, toks: Tok[], capturedAt: Date, forwardDate: boolean): DateHit[] {
  const hits: DateHit[] = []
  for (const r of dateParser.parse(text, capturedAt, { forwardDate })) {
    const start = r.index
    const end = r.index + r.text.length
    const bare = r.text.trim()
    // "with June" is a person. A month on its own is only a date after a word
    // like "in" or "until".
    if (MONTH_WORD.test(bare) && !r.start.isCertain('day') && !r.start.isCertain('weekday')) {
      const before = toks.filter((t) => t.end <= start).pop()
      if (!before || !MONTH_LEAD.has(before.norm)) continue
    }
    hits.push({ start, end, result: r })
  }
  return hits
}

const atTime = (d: Date, h: number, m = 0) => {
  const x = new Date(d)
  x.setHours(h, m, 0, 0)
  return x
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** A time of day said in words, or implied by the meal it was over. */
function impliedHour(words: string): [number, number] | null {
  if (/\b(tonight|last night|night)\b/.test(words)) return [19, 0]
  if (/\bevening\b/.test(words)) return [18, 0]
  if (/\bafternoon\b/.test(words)) return [14, 0]
  if (/\b(noon|midday)\b/.test(words)) return [12, 0]
  if (/\bmorning\b/.test(words)) return [9, 0]
  if (/\bbreakfast\b/.test(words)) return [8, 0]
  if (/\bbrunch\b/.test(words)) return [10, 30]
  if (/\blunch\b/.test(words)) return [12, 30]
  if (/\bdinner\b/.test(words)) return [19, 0]
  if (/\b(drinks|beers?|wine)\b/.test(words)) return [18, 0]
  return null
}

function resolveWhen(
  hit: DateHit | undefined,
  clause: string,
  mode: 'interaction' | 'reminder',
  capturedAt: Date,
): { when: Date; whenSource: WhenSource } {
  const words = clause.toLowerCase()
  if (!hit) {
    if (mode === 'interaction') return { when: capturedAt, whenSource: 'captured' }
    const tomorrow = new Date(capturedAt)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { when: atTime(tomorrow, 9), whenSource: 'assumed' }
  }

  const s = hit.result.start
  let when = s.date()

  if (s.isCertain('hour')) {
    // "at 3" means the afternoon — nobody books things for 3am — unless what
    // it's for is a morning thing: "coffee at 7:30" is breakfast time.
    const h = when.getHours()
    const implied = impliedHour(words)
    const morning = /\b(coffee|breakfast|brekkie|morning)\b/.test(words) || (implied !== null && implied[0] < 12)
    if (!s.isCertain('meridiem') && h >= 1 && h <= 7 && !morning) when = atTime(when, h + 12, when.getMinutes())
  } else {
    const implied = impliedHour(`${hit.result.text.toLowerCase()} ${words}`)
    if (implied) when = atTime(when, implied[0], implied[1])
    else if (mode === 'reminder') when = atTime(when, 9)
    else if (sameDay(when, capturedAt)) when = atTime(when, capturedAt.getHours(), capturedAt.getMinutes())
    else when = atTime(when, 12)
  }

  if (mode === 'interaction' && when.getTime() > capturedAt.getTime() + 3_600_000) {
    // "Met her on Tuesday", said on a Monday, means last Tuesday.
    // By the calendar, not by 7 × 24 hours, which is an hour out across a
    // daylight-saving change.
    if (s.isCertain('weekday') && !s.isCertain('day')) {
      const back = new Date(when)
      back.setDate(back.getDate() - 7)
      when = back
    }
    // "Lunch on the 3rd", said on the 10th, means this month's 3rd.
    else if (s.isCertain('day') && !s.isCertain('month')) {
      const back = new Date(when)
      back.setMonth(back.getMonth() - 1)
      when = back
    }
  }
  return { when, whenSource: s.isCertain('hour') ? 'spoken' : 'spoken-day' }
}

// ---------------------------------------------------------------- what kind of thing

/** Wording that means something to do. */
const TO_DO = [
  /\bremind(er)?\b/,
  /\bdon'?t forget\b/,
  /\bnote to self\b/,
  /\b(need|have|got|want|ought) to\b/,
  /\bgotta\b/,
  /\b(must|should)\b/,
  /\bto ?do\b/,
  /\btask\b/,
  /\bfollow(ing)?[- ]?up\b/,
  /\bcheck in (with|on)\b/,
  /^\s*(please\s+)?(call|ring|phone|email|text|message|send|book|ask|invite|thank|congratulate|wish|pay|buy|get|organi[sz]e|arrange|schedule|set up|chase|ping|reply|respond|confirm)\b/,
]

/** Wording that means something already happened. */
const HAPPENED = [
  /\b(met|spoke|talked|chatted|caught up|called|rang|phoned|emailed|texted|messaged|saw|visited|discussed|mentioned|attended|interviewed|presented|introduced|bumped into|ran into)\b/,
  /\bhad (a |an |some )?(coffee|lunch|dinner|breakfast|brunch|drinks?|beers?|call|chat|meeting|catch[- ]?up|video call|zoom)\b/,
  /\b(went|was|were) (to|at)\b/,
  /\b(told|said|says|mentioned|asked) (me|us)\b/,
  /\b(heard|got (an? )?(email|message|text|call)) from\b/,
  /\b(yesterday|last (night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this morning|earlier today|ago)\b/,
  /\b(went|gave|made|took|came|left|said|sent|bought|brought|thought|found|won|lost|began|knew|wrote|spent|paid|flew|drove|ate|drank|sat|held|kept|felt|heard|became|got (a|an|the|her|his|their|engaged|married|promoted))\b/,
  // Regular past tense — "started", "moved", "joined" — less a few words that
  // only happen to end in -ed.
  /\b(?!(?:need|feed|seed|speed|reed|bleed|breed|greed|heed|weed|bed|red|wed|shed|fred|ted|ned|embed|proceed|exceed|succeed|indeed)\b)[a-z]{2,}ed\b/,
]

const count = (patterns: RegExp[], text: string) => patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)

function interactionKind(words: string): InteractionKind {
  if (/\b(video call|zoom|teams|facetime|google meet)\b/.test(words)) return 'call'
  if (/\b(called|rang|phoned|phone call|on the phone|a call|call with|called me)\b/.test(words)) return 'call'
  if (/\b(e-?mail(ed)?)\b/.test(words)) return 'email'
  if (/\b(texted|text|messaged|message|whatsapp|sms|dm|dmed)\b/.test(words)) return 'message'
  if (/\b(conference|event|wedding|party|funeral|gala|launch|seminar|workshop|summit|expo|networking)\b/.test(words)) return 'event'
  if (/\b(met|meet|meeting|coffee|lunch|dinner|breakfast|brunch|drinks?|beers?|catch[- ]?up|caught up|visited|saw|ran into|bumped into|interview)\b/.test(words))
    return 'meeting'
  return 'note'
}

function activityTitle(words: string): string | null {
  const table: [RegExp, string][] = [
    [/\b(video call|zoom|teams|facetime|google meet)\b/, 'Video call'],
    [/\bcoffee\b/, 'Coffee'],
    [/\bbreakfast\b/, 'Breakfast'],
    [/\bbrunch\b/, 'Brunch'],
    [/\blunch\b/, 'Lunch'],
    [/\bdinner\b/, 'Dinner'],
    [/\b(drinks?|beers?)\b/, 'Drinks'],
    [/\b(catch[- ]?up|caught up)\b/, 'Catch-up'],
    [/\binterview(ed)?\b/, 'Interview'],
    [/\bconference\b/, 'Conference'],
    [/\bwedding\b/, 'Wedding'],
    [/\bparty\b/, 'Party'],
    [/\b(called|rang|phoned|phone call|on the phone|a call|call with)\b/, 'Call'],
    [/\b(e-?mail(ed)?)\b/, 'Email'],
    [/\b(texted|messaged|whatsapp)\b/, 'Message'],
    [/\b(meeting|met)\b/, 'Meeting'],
  ]
  return table.find(([re]) => re.test(words))?.[1] ?? null
}

// ---------------------------------------------------------------- clauses

type Clause = { start: number; end: number; text: string; mode: 'interaction' | 'reminder' | 'either' }

const SPLIT_BEFORE =
  /(?:,\s*|\s+(?:and|but)\s+(?:then\s+)?|\s+then\s+)(?=(?:please\s+)?(?:remind me|don'?t forget|i need to|need to|i have to|i should|i must|i want to|follow[- ]?up|todo|to do|note to self)\b)/gi

function clausesOf(text: string): Clause[] {
  const out: Clause[] = []
  const sentences = [...text.matchAll(/[^.!?;\n]+[.!?;]?/g)]
  for (const s of sentences) {
    const base = s.index!
    const piece = s[0]
    let last = 0
    const cuts: number[] = []
    for (const m of piece.matchAll(SPLIT_BEFORE)) cuts.push(m.index! + m[0].length)
    for (const cut of [...cuts, piece.length]) {
      const part = piece.slice(last, cut)
      const lead = part.length - part.trimStart().length
      // Splitting before "…and remind me" leaves the "and" on the end of the
      // first half; it belongs to neither.
      const body = part.trim().replace(/(?:[\s,;]+(?:and|but|then|so|also))+[\s,;]*$|[\s,;]+$/i, '')
      if (body) out.push({ start: base + last + lead, end: base + last + lead + body.length, text: body, mode: 'either' })
      last = cut
    }
  }
  for (const c of out) {
    const words = c.text.toLowerCase()
    const todo = count(TO_DO, words)
    const done = count(HAPPENED, words)
    c.mode = todo > done ? 'reminder' : done > todo ? 'interaction' : 'either'
  }
  return out
}

/** Strip "remind me to" and the date out of a to-do, leaving the thing to do. */
function reminderTitle(clause: Clause, dateHits: DateHit[], name: string | null): string {
  let t = clause.text
  // Cut each date out by position, along with the words that introduced it —
  // "on the 14th of October" leaves nothing behind, rather than "on the".
  for (const h of [...dateHits].sort((a, b) => b.start - a.start)) {
    if (h.start < clause.start || h.end > clause.end) continue
    const before = t
      .slice(0, h.start - clause.start)
      .replace(/(?:\s+|^)(?:(?:on|by|at|in|during|before|until|till|for|from|due)\s+)?(?:the\s+)?$/i, '')
    t = before + ' ' + t.slice(h.end - clause.start)
  }
  t = t
    .replace(
      /^\s*(?:and\s+|but\s+|then\s+|so\s+)*(?:please\s+)?(?:remind me (?:to |that |about )?|reminder:?\s*(?:to )?|don'?t forget (?:to )?|note to self:?\s*|i (?:need|have|want|must|should|ought) to |need to |have to |got to |gotta |must |should |to ?do:?\s*|task:?\s*)/i,
      '',
    )
    .replace(/\s+(?:on|by|at|for|this|next|in|before|until)\s*(?=[,.!?;]|\s*$)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,.;!?]+$/g, '')
  if (name) t = t.replace(/\b(him|her)\b/gi, name)
  t = t ? t[0].toUpperCase() + t.slice(1) : 'Follow up'
  return t.length > 90 ? `${t.slice(0, 87).trimEnd()}…` : t
}

const tidy = (s: string) => {
  const t = s.trim().replace(/\s{2,}/g, ' ')
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

// ---------------------------------------------------------------- names

function findMentions(toks: Tok[], index: NameIndex, blocked: (t: Tok) => boolean): Mention[] {
  type Hit = { i: number; n: number; candidates: Candidate[]; best: number }
  const hits: Hit[] = []

  for (let i = 0; i < toks.length; i++) {
    for (let n = 1; n <= 4 && i + n <= toks.length; n++) {
      const span = toks.slice(i, i + n)
      if (span.some(blocked)) break
      if (FILLER.has(span[0].norm) || FILLER.has(span[n - 1].norm)) continue
      const key = span.map((t) => t.norm).join('')
      if (key.length < 2) continue
      const sound = soundKey(span.map((t) => t.raw).join(' '))
      const allCommon = span.every((t) => COMMON.has(t.norm))
      const cued = i > 0 && PERSON_CUES.has(toks[i - 1].norm)

      const pool = new Set<Variant>([...(index.byInitial.get(key[0]) ?? []), ...(index.byInitial.get(sound[0]) ?? [])])
      const best = new Map<string, Candidate>()
      for (const v of pool) {
        const match = matchScore(key, sound, span.map((t) => t.norm), v)
        let score = match
        if (score === 0) continue
        // One word matches far too easily on its own, so it has to be close.
        if (n === 1 && score < 0.92 && !(sound === v.sound && sound.length >= 3)) continue
        if (n > 1 && score < 0.86) continue
        // "Meeting in May" isn't about May. An everyday word only counts as a
        // name when something before it says it's a person.
        if ((allCommon || v.common) && !cued && score < 1.01 && v.via !== 'alias') continue
        score = score * VIA_WEIGHT[v.via]
        const prev = best.get(v.contactId)
        if (!prev || score > prev.score) best.set(v.contactId, { contactId: v.contactId, score, match, via: v.via })
      }
      if (best.size === 0) continue
      const candidates = [...best.values()].sort(
        (a, b) => b.score + (index.prior.get(b.contactId) ?? 0) - (a.score + (index.prior.get(a.contactId) ?? 0)),
      )
      hits.push({ i, n, candidates: candidates.slice(0, 6), best: candidates[0].score })
    }
  }

  // Keep the strongest non-overlapping stretches; on a tie, the longer one —
  // "Scrooge McDuck" over "McDuck", which on its own fits two people.
  hits.sort((a, b) => b.best - a.best || b.n - a.n)
  const used = new Set<number>()
  const chosen: Hit[] = []
  for (const h of hits) {
    const idx = Array.from({ length: h.n }, (_, k) => h.i + k)
    if (idx.some((k) => used.has(k))) continue
    idx.forEach((k) => used.add(k))
    chosen.push(h)
  }

  return chosen
    .sort((a, b) => a.i - b.i)
    .map((h) => {
      const top = h.candidates[0]
      const next = h.candidates[1]
      const unique = !next || next.score < top.score - 0.05
      // Heard exactly, and nobody else came close: with one Akanksha in the
      // address book, "Akanksha" is as good as a full name.
      const confidence: Confidence =
        (top.match >= 0.999 && !next) || (top.score >= 0.97 && unique)
          ? 'high'
          : top.score >= 0.9 && unique
            ? 'medium'
            : 'low'
      const start = toks[h.i].start
      const end = toks[h.i + h.n - 1].end
      return {
        start,
        end,
        heard: toks.slice(h.i, h.i + h.n).map((t) => t.raw).join(' '),
        candidates: h.candidates,
        confidence,
      }
    })
}

// ---------------------------------------------------------------- the whole thing

export function parseCapture(text: string, capturedAt: Date, index: NameIndex): ParsedCapture {
  const toks = tokenize(text)
  const clauses = clausesOf(text)

  // Dates first: a word the date claims ("Friday", "the 3rd") can't also be a
  // name. Read backwards by default; to-do clauses read forwards.
  const backHits = findDates(text, toks, capturedAt, false)
  const fwdHits = findDates(text, toks, capturedAt, true)
  const inDate = (t: Tok) => backHits.some((h) => t.start >= h.start && t.end <= h.end)
  const mentions = findMentions(toks, index, inDate)

  const hitIn = (c: Clause, hits: DateHit[]) => hits.find((h) => h.start >= c.start && h.end <= c.end)
  const mentionsIn = (c: Clause) => mentions.filter((m) => m.start >= c.start && m.end <= c.end)

  // A clause with no tense either way ("Lunch with Sarah Friday", "Board
  // meeting in May") is settled by its date. Things that happened nearly always
  // get said in the past tense, so a tenseless one with a date is read as a
  // plan — unless even the forward reading has already gone by. It's judged
  // at the time it would be booked for: "Lunch with Sarah Friday", said on
  // Friday morning, is today's lunch, still to come.
  for (const c of clauses) {
    if (c.mode !== 'either') continue
    const hit = hitIn(c, fwdHits)
    if (hit && resolveWhen(hit, c.text, 'reminder', capturedAt).when.getTime() > capturedAt.getTime()) c.mode = 'reminder'
    else if (hit) c.mode = 'interaction'
  }

  const primary =
    clauses.find((c) => c.mode === 'interaction') ??
    clauses.find((c) => c.mode === 'reminder') ??
    clauses[0] ?? { start: 0, end: text.length, text, mode: 'either' as const }
  const isReminder = primary.mode === 'reminder'
  const kindConfident = primary.mode !== 'either'

  // Whose item is it: names in the main clause, else anyone mentioned at all.
  const own = mentionsIn(primary)
  const peopleFrom = own.length > 0 ? own : mentions
  const contactIds = [...new Set(peopleFrom.map((m) => m.candidates[0].contactId))]
  const firstName = (() => {
    const m = peopleFrom[0]
    if (!m || contactIds.length !== 1) return null
    const said = m.heard.split(/\s+/)[0]
    return said ? said[0].toUpperCase() + said.slice(1) : null
  })()

  const { when, whenSource } = isReminder
    ? resolveWhen(hitIn(primary, fwdHits), primary.text, 'reminder', capturedAt)
    : resolveWhen(hitIn(primary, backHits), primary.text, 'interaction', capturedAt)

  const extra = clauses.filter((c) => c !== primary)
  const followUps: ParsedReminder[] = extra
    .filter((c) => c.mode === 'reminder')
    .map((c) => {
      const r = resolveWhen(hitIn(c, fwdHits), c.text, 'reminder', capturedAt)
      const named = mentionsIn(c)[0]
      return {
        title: reminderTitle(c, fwdHits, firstName),
        due: r.when,
        whenSource: r.whenSource,
        contactId: named ? named.candidates[0].contactId : (contactIds[0] ?? null),
      }
    })
  const context = extra.filter((c) => c.mode !== 'reminder').map((c) => c.text)

  let title: string | null
  let notes: string | null
  const words = primary.text.toLowerCase()
  if (isReminder) {
    title = reminderTitle(primary, fwdHits, firstName)
    notes = context.length > 0 ? tidy(context.join(' ')) : null
  } else {
    title = activityTitle(words)
    notes = tidy([primary.text, ...context].join(' ')) || null
  }

  return {
    kind: isReminder ? 'reminder' : interactionKind(words),
    kindConfident,
    when,
    whenSource,
    title,
    notes,
    mentions,
    contactIds,
    dateSpans: (isReminder ? fwdHits : backHits).map(({ start, end }) => ({ start, end })),
    followUps,
  }
}

// ---------------------------------------------------------------- display

export type Segment = { text: string; mark: 'name' | 'date' | null }

/** Break the sentence up so the review screen can show what was read as what. */
export function segmentsOf(text: string, mentions: Mention[], dates: Span[]): Segment[] {
  const marks: (Span & { mark: 'name' | 'date' })[] = [
    ...mentions.map((m) => ({ start: m.start, end: m.end, mark: 'name' as const })),
    ...dates.map((d) => ({ ...d, mark: 'date' as const })),
  ].sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let at = 0
  for (const m of marks) {
    if (m.start < at) continue
    if (m.start > at) out.push({ text: text.slice(at, m.start), mark: null })
    out.push({ text: text.slice(m.start, m.end), mark: m.mark })
    at = m.end
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: null })
  return out
}

/**
 * What to remember when a guess was corrected: the words as heard, keyed the
 * way the index keys names, so the same mishearing finds the right person next
 * time. Returns null when there's nothing worth keeping.
 */
export function aliasFor(heard: string): string | null {
  const key = normalizeName(heard)
  return key.length >= 2 && key.length <= 80 ? key : null
}
