/**
 * What an assistant can do with the CRM. Each tool runs inside one database
 * transaction, as the access key's owner, under the app's own row-level
 * security — so a tool can only ever see or change its owner's rows, and a
 * tool that fails part-way changes nothing.
 *
 * Nothing here deletes. Updates keep what they replaced (see `changes`), and
 * notes are added to rather than overwritten unless a tool is told otherwise.
 */
import type { TransactionSql } from 'npm:postgres@3.4.5'
import { nameScore, normalizeName } from './names.ts'

export type Ctx = { tx: TransactionSql; timezone: string }
export type ToolResult = {
  /** One or two sentences, fit to be read out: the assistant is often speaking. */
  summary: string
  data: Record<string, unknown>
  contactIds?: string[]
  /** For updates: each changed field's value before and after. */
  changes?: Record<string, { before: unknown; after: unknown }>
}
export type Tool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  run: (args: Args, ctx: Ctx) => Promise<ToolResult>
}

/** A problem the assistant can fix by asking again differently. Shown to it as-is. */
export class ToolError extends Error {}

type Args = Record<string, unknown>

// ------------------------------------------------------------------ inputs

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^(\d{4}-\d{2}-\d{2}|today|yesterday|tomorrow)$/i

const given = (a: Args, k: string) => Object.prototype.hasOwnProperty.call(a, k) && a[k] !== undefined

/** Text: absent → undefined, null or blank → null, otherwise trimmed. */
function text(a: Args, k: string, max = 200): string | null | undefined {
  if (!given(a, k)) return undefined
  const v = a[k]
  if (v === null) return null
  if (typeof v !== 'string') throw new ToolError(`${k} should be text.`)
  const t = v.trim()
  if (t.length > max) throw new ToolError(`${k} is too long (${t.length} characters; the most is ${max}).`)
  return t || null
}

function required(a: Args, k: string, max = 200): string {
  const t = text(a, k, max)
  if (!t) throw new ToolError(`${k} is required.`)
  return t
}

function id(a: Args, k: string): string {
  const v = a[k]
  if (typeof v !== 'string' || !UUID.test(v)) {
    throw new ToolError(`${k} should be a person or entry id like "3f2b…", as returned by find_people or get_person.`)
  }
  return v.toLowerCase()
}

function ids(a: Args, k: string, { min = 1, max = 20 } = {}): string[] {
  const v = a[k]
  const list = typeof v === 'string' ? [v] : v
  if (!Array.isArray(list) || list.length < min) throw new ToolError(`${k} should list at least ${min} person id.`)
  if (list.length > max) throw new ToolError(`${k} can list at most ${max} people.`)
  const out = list.map((x, i) => id({ [`${k}[${i}]`]: x }, `${k}[${i}]`))
  return [...new Set(out)]
}

function oneOf<T extends string>(a: Args, k: string, allowed: readonly T[]): T | undefined {
  if (!given(a, k) || a[k] === null) return undefined
  const v = String(a[k]).toLowerCase() as T
  if (!allowed.includes(v)) throw new ToolError(`${k} should be one of: ${allowed.join(', ')}.`)
  return v
}

function int(a: Args, k: string, lo: number, hi: number): number | null | undefined {
  if (!given(a, k)) return undefined
  if (a[k] === null) return null
  const n = Number(a[k])
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ToolError(`${k} should be a whole number from ${lo} to ${hi}.`)
  return n
}

/** A day: YYYY-MM-DD, today, yesterday or tomorrow. */
function day(a: Args, k: string): string | null | undefined {
  const t = text(a, k, 20)
  if (t == null) return t
  if (!DAY.test(t)) throw new ToolError(`${k} should be a date as YYYY-MM-DD (or today / yesterday).`)
  return t.toLowerCase()
}

/** A birthday: YYYY-MM-DD, or MM-DD when the year isn't known. */
function birthday(a: Args, k: string): { date: string; hasYear: boolean } | null | undefined {
  const t = text(a, k, 12)
  if (t == null) return t
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (full) return { date: t, hasYear: true }
  const short = /^-{0,2}(\d{2})-(\d{2})$/.exec(t)
  // Year unknown: stored against 2000, a leap year, as the app does.
  if (short) return { date: `2000-${short[1]}-${short[2]}`, hasYear: false }
  throw new ToolError(`${k} should be YYYY-MM-DD, or MM-DD if the year isn't known.`)
}

/** A web address. Anything that isn't plainly http(s) is refused, so a stored link can't run script. */
function link(a: Args, k: string): string | null | undefined {
  const t = text(a, k, 300)
  if (t == null) return t
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    throw new ToolError(`${k} isn't a web address.`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ToolError(`${k} should be an http or https address.`)
  return u.toString()
}

/**
 * When something happened: a full timestamp (with or without an offset — none
 * means the owner's own time zone), or a day alone, which gets `defaultTime`.
 * Parsed by the database, which is already set to the owner's zone.
 */
async function moment(tx: TransactionSql, value: string, defaultTime: string): Promise<Date> {
  const v = value.trim()
  const ok = DAY.test(v) || /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i.test(v) || /^now$/i.test(v)
  if (!ok) throw new ToolError(`I couldn't read "${value}" as a time. Use YYYY-MM-DDTHH:MM (the user's local time), or YYYY-MM-DD.`)
  const [r] = DAY.test(v)
    ? await tx`select (${v.toLowerCase()}::text::date + ${defaultTime}::text::time)::timestamptz as t`
    : await tx`select ${v}::text::timestamptz as t`
  return r.t as Date
}

// ----------------------------------------------------------------- outputs

const fullName = (c: { first_name: string; last_name: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ')

const role = (c: { title: string | null; company: string | null }) =>
  c.title && c.company ? `${c.title} at ${c.company}` : c.company || c.title || ''

function when(d: Date | null, tz: string, withTime = true): string | null {
  if (!d) return null
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d)
}

const clip = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s)

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

const KINDS = ['meeting', 'call', 'email', 'message', 'event'] as const
const KIND_WORD: Record<string, string> = {
  meeting: 'a meeting',
  call: 'a call',
  email: 'an email',
  message: 'a message',
  event: 'an event',
  note: 'a note',
}

type Person = { id: string; first_name: string; last_name: string | null }

/** The people these ids name — every one of them, or a clear refusal. */
async function people(tx: TransactionSql, list: string[]): Promise<Person[]> {
  const rows = await tx<Person[]>`
    select id, first_name, last_name from public.contacts where id = any(${list}::uuid[])`
  const found = new Set(rows.map((r) => r.id))
  const missing = list.filter((x) => !found.has(x))
  if (missing.length) {
    throw new ToolError(`No person with id ${missing.join(', ')}. Look them up with find_people and use the id it returns.`)
  }
  return list.map((x) => rows.find((r) => r.id === x)!)
}

async function person(tx: TransactionSql, personId: string): Promise<Person> {
  return (await people(tx, [personId]))[0]
}

type Candidate = Person & { nickname: string | null; company: string | null; title: string | null; location: string | null }

async function candidates(tx: TransactionSql): Promise<Candidate[]> {
  return tx<Candidate[]>`
    select id, first_name, last_name, nickname, company, title, location
    from public.contacts where not archived`
}

const label = (c: Candidate) => {
  const r = role(c)
  return r ? `${fullName(c)} (${r})` : fullName(c)
}

// ------------------------------------------------------------------- tools

const findPeople: Tool = {
  name: 'find_people',
  title: 'Find people',
  description:
    'Search the CRM for people by name (spelling can be rough — names that sound alike are found) and/or company. ' +
    'Returns each match with the person_id every other tool needs. Always use this before adding someone, to avoid duplicates.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'All or part of their name, e.g. "Sarah" or "Sarah Little".' },
      company: { type: 'string', description: 'Only people whose company contains this.' },
      limit: { type: 'integer', minimum: 1, maximum: 25, default: 8 },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const name = text(a, 'name', 100)
    const company = text(a, 'company', 100)
    const limit = int(a, 'limit', 1, 25) ?? 8
    if (!name && !company) throw new ToolError('Give a name, a company, or both.')

    const companyKey = company ? normalizeName(company) : null
    const scored = (await candidates(tx))
      .filter((c) => !companyKey || normalizeName(c.company ?? '').includes(companyKey))
      .map((c) => ({ c, score: name ? nameScore(name, c) : 1 }))
      .filter((x) => x.score >= 0.84)
      .sort((x, y) => y.score - x.score || fullName(x.c).localeCompare(fullName(y.c)))
      .slice(0, limit)

    const last = scored.length
      ? await tx<{ id: string; last_contacted: Date | null }[]>`
          select id, last_contacted from public.contacts_overview where id = any(${scored.map((x) => x.c.id)}::uuid[])`
      : []
    const results = scored.map(({ c, score }) => ({
      person_id: c.id,
      name: fullName(c),
      nickname: c.nickname,
      title: c.title,
      company: c.company,
      location: c.location,
      last_in_touch: when(last.find((l) => l.id === c.id)?.last_contacted ?? null, timezone, false),
      match: score >= 0.999 ? 'exact' : 'close',
    }))

    const what = [name && `"${name}"`, company && `at ${company}`].filter(Boolean).join(' ')
    const summary =
      results.length === 0
        ? `No one matching ${what} in the CRM.`
        : results.length === 1
          ? `Found ${label(scored[0].c)}.`
          : `Found ${results.length} people matching ${what}: ${listNames(scored.map((x) => label(x.c)))}.`
    return { summary, data: { results }, contactIds: results.map((r) => r.person_id) }
  },
}

const getPerson: Tool = {
  name: 'get_person',
  title: 'Get a person',
  description:
    "Everything the CRM holds on one person: details, facts, family, work, groups, their connections to other people, " +
    'open reminders, and recent timeline entries (meetings, calls, notes) with the entry_id needed to update one.',
  inputSchema: {
    type: 'object',
    properties: { person_id: { type: 'string', description: 'From find_people.' } },
    required: ['person_id'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const pid = id(a, 'person_id')
    const [c] = await tx<(Candidate & Record<string, any>)[]>`
      select id, first_name, last_name, nickname, kind, company, title, emails, phones, location,
             birthday::text as birthday, birthday_has_year, how_we_met, met_on::text as met_on, summary,
             keep_in_touch_days, website, linkedin_url, favorite, last_contacted
      from public.contacts_overview where id = ${pid}`
    if (!c) throw new ToolError(`No person with id ${pid}. Look them up with find_people.`)

    const [facts, family, work, groups, connections, timeline, reminders] = await Promise.all([
      tx`select id as detail_id, label, value from public.facts where contact_id = ${pid} order by created_at`,
      tx`select name, relation, birthdate::text as birthdate, notes from public.family_members where contact_id = ${pid} order by created_at`,
      tx`select company, title, start_year, end_year, is_current from public.work_history
         where contact_id = ${pid} order by is_current desc, start_year desc nulls last limit 6`,
      tx`select g.name, gm.role from public.group_members gm join public.groups g on g.id = gm.group_id where gm.contact_id = ${pid} order by g.name`,
      tx`select r.id as connection_id, o.id as person_id, o.first_name, o.last_name, r.notes as comment
         from public.relationships r
         join public.contacts o on o.id = case when r.from_contact = ${pid} then r.to_contact else r.from_contact end
         where r.from_contact = ${pid} or r.to_contact = ${pid}
         order by o.first_name`,
      tx`select i.id, i.kind, i.happened_at, i.title, i.location, i.notes, i.remember
         from public.interactions i join public.interaction_participants ip on ip.interaction_id = i.id
         where ip.contact_id = ${pid} order by i.happened_at desc limit 10`,
      tx`select title, due_at from public.reminders where contact_id = ${pid} and status = 'open' order by due_at limit 10`,
    ])

    const data = {
      person_id: c.id,
      name: fullName(c),
      nickname: c.nickname,
      kind: c.kind,
      title: c.title,
      company: c.company,
      location: c.location,
      emails: c.emails,
      phones: c.phones,
      birthday: c.birthday ? (c.birthday_has_year ? c.birthday : c.birthday.slice(5)) : null,
      how_we_met: c.how_we_met,
      met_on: c.met_on,
      summary: c.summary,
      keep_in_touch_every_days: c.keep_in_touch_days,
      website: c.website,
      linkedin_url: c.linkedin_url,
      favorite: c.favorite,
      last_in_touch: when(c.last_contacted, timezone, false),
      details: facts,
      family,
      work_history: work,
      groups,
      connections: connections.map((r) => ({
        connection_id: r.connection_id,
        person_id: r.person_id,
        name: fullName(r as Person),
        comment: r.comment,
      })),
      open_reminders: reminders.map((r) => ({ title: r.title, due: when(r.due_at, timezone) })),
      recent_timeline: timeline.map((t) => ({
        entry_id: t.id,
        kind: t.kind,
        when: when(t.happened_at, timezone),
        title: t.title,
        location: t.location,
        notes: clip(t.notes, 600),
        key_points: clip(t.remember, 400),
      })),
    }
    const r = role(c)
    const summary =
      `${fullName(c)}${r ? `, ${r}` : ''}${c.location ? `, ${c.location}` : ''}. ` +
      (c.last_contacted ? `Last in touch ${when(c.last_contacted, timezone, false)}.` : 'Nothing logged with them yet.')
    return { summary, data, contactIds: [c.id] }
  },
}

const listTimeline: Tool = {
  name: 'list_timeline',
  title: 'List recent meetings and notes',
  description:
    'Recent timeline entries (meetings, calls, emails, messages, events, notes), newest first — for everyone, or one person. ' +
    'Use it to find the entry_id of something to update, e.g. "the coffee I logged yesterday".',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string', description: 'Only entries with this person. Leave out for everyone.' },
      days: { type: 'integer', minimum: 1, maximum: 3650, default: 30, description: 'How far back to look.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const pid = given(a, 'person_id') && a.person_id !== null ? id(a, 'person_id') : null
    const days = int(a, 'days', 1, 3650) ?? 30
    const limit = int(a, 'limit', 1, 50) ?? 10
    if (pid) await person(tx, pid)
    const rows = await tx`
      select i.id, i.kind, i.happened_at, i.title, i.location, i.notes, i.remember,
        coalesce(
          json_agg(json_build_object('person_id', c.id, 'name', concat_ws(' ', c.first_name, c.last_name)) order by c.first_name)
            filter (where c.id is not null),
          '[]'
        ) as people
      from public.interactions i
      left join public.interaction_participants ip on ip.interaction_id = i.id
      left join public.contacts c on c.id = ip.contact_id
      where i.happened_at >= now() - make_interval(days => ${days})
        and (${pid}::text is null or exists (
          select 1 from public.interaction_participants x where x.interaction_id = i.id and x.contact_id = ${pid}::text::uuid))
      group by i.id
      order by i.happened_at desc
      limit ${limit}`
    const entries = rows.map((t) => ({
      entry_id: t.id,
      kind: t.kind,
      when: when(t.happened_at, timezone),
      title: t.title,
      people: t.people,
      location: t.location,
      notes: clip(t.notes, 300),
      key_points: clip(t.remember, 200),
    }))
    const summary = entries.length
      ? `${entries.length} timeline ${entries.length === 1 ? 'entry' : 'entries'} in the last ${days} days.`
      : `Nothing on the timeline in the last ${days} days.`
    return { summary, data: { entries }, contactIds: pid ? [pid] : [] }
  },
}

const PERSON_FIELDS = {
  first_name: { type: 'string' },
  last_name: { type: 'string' },
  nickname: { type: 'string' },
  title: { type: 'string', description: 'Job title.' },
  company: { type: 'string' },
  location: { type: 'string', description: 'City or area.' },
  kind: { type: 'string', enum: ['business', 'personal', 'both'] },
  how_we_met: { type: 'string' },
  met_on: { type: 'string', description: 'YYYY-MM-DD, or today / yesterday.' },
  summary: { type: 'string', description: 'A short description of who they are, shown at the top of their profile.' },
  birthday: { type: 'string', description: 'YYYY-MM-DD, or MM-DD if the year is unknown.' },
  website: { type: 'string' },
  linkedin_url: { type: 'string' },
  keep_in_touch_every_days: { type: 'integer', minimum: 1, maximum: 3650, description: 'Remind the user to reach out this often.' },
} as const

/** The plain profile fields present in `a`, checked and ready to store. */
type Field = string | number | boolean | null

function profileFields(a: Args) {
  const out: Record<string, Field> = {}
  const set = (k: string, v: Field | undefined) => {
    if (v !== undefined) out[k] = v
  }
  set('last_name', text(a, 'last_name', 100))
  set('nickname', text(a, 'nickname', 60))
  set('title', text(a, 'title', 150))
  set('company', text(a, 'company', 150))
  set('location', text(a, 'location', 150))
  set('kind', oneOf(a, 'kind', ['business', 'personal', 'both'] as const))
  set('how_we_met', text(a, 'how_we_met', 1000))
  set('met_on', day(a, 'met_on'))
  set('summary', text(a, 'summary', 4000))
  set('website', link(a, 'website'))
  set('linkedin_url', link(a, 'linkedin_url'))
  set('keep_in_touch_days', int(a, 'keep_in_touch_every_days', 1, 3650))
  const b = birthday(a, 'birthday')
  if (b !== undefined) {
    out.birthday = b?.date ?? null
    out.birthday_has_year = b?.hasYear ?? true
  }
  return out
}

type Labeled = { label: string; value: string }

function withValue(list: Labeled[], value: string | null | undefined, label: string | null | undefined, fallback: () => string) {
  if (!value) return list
  if (list.some((x) => x.value.toLowerCase() === value.toLowerCase())) return list
  return [...list, { label: label || fallback(), value }]
}

const addPerson: Tool = {
  name: 'add_person',
  title: 'Add a person',
  description:
    'Add someone new to the CRM. Check find_people first: if someone with the same name already exists this does not add ' +
    'them, and returns the existing match instead — use update_person for them, or call again with allow_duplicate if it really is someone else.',
  inputSchema: {
    type: 'object',
    properties: {
      ...PERSON_FIELDS,
      email: { type: 'string' },
      phone: { type: 'string' },
      allow_duplicate: { type: 'boolean', description: 'Add even though someone with this name exists.' },
    },
    required: ['first_name'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(a, { tx }) {
    const first = required(a, 'first_name', 100)
    const fields = profileFields(a)
    const email = text(a, 'email', 200)
    const phone = text(a, 'phone', 50)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ToolError('email should look like name@example.com.')

    const wanted = normalizeName([first, fields.last_name].filter(Boolean).join(' '))
    const same = (await candidates(tx)).filter((c) => normalizeName(fullName(c)) === wanted)
    if (same.length && a.allow_duplicate !== true) {
      return {
        summary:
          `Not added — the CRM already has ${listNames(same.map(label))}. ` +
          'To change their details use update_person; if this is a different person, add again with allow_duplicate.',
        data: { added: false, existing: same.map((c) => ({ person_id: c.id, name: fullName(c), title: c.title, company: c.company })) },
        contactIds: same.map((c) => c.id),
      }
    }

    const emails = withValue([] as Labeled[], email, null, () => 'work')
    const phones = withValue([] as Labeled[], phone, null, () => 'mobile')
    const [c] = await tx<Candidate[]>`
      insert into public.contacts (
        first_name, last_name, nickname, title, company, location, kind, how_we_met, met_on, summary,
        website, linkedin_url, keep_in_touch_days, birthday, birthday_has_year, emails, phones
      ) values (
        ${first}, ${fields.last_name ?? null}, ${fields.nickname ?? null}, ${fields.title ?? null}, ${fields.company ?? null},
        ${fields.location ?? null}, ${(fields.kind as string) ?? 'business'}, ${fields.how_we_met ?? null},
        ${fields.met_on ?? null}::text::date, ${fields.summary ?? null}, ${fields.website ?? null}, ${fields.linkedin_url ?? null},
        ${fields.keep_in_touch_days ?? null}::text::int, ${fields.birthday ?? null}::text::date,
        ${(fields.birthday_has_year as boolean | undefined) ?? true}, ${tx.json(emails)}, ${tx.json(phones)}
      ) returning id, first_name, last_name, title, company`
    return {
      summary: `Added ${fullName(c)}${role(c) ? `, ${role(c)}` : ''}.`,
      data: { added: true, person_id: c.id, name: fullName(c) },
      contactIds: [c.id],
    }
  },
}

/** Columns update_person can set, and the database type each is stored as. */
const COLUMN_TYPE: Record<string, string> = {
  first_name: 'text',
  last_name: 'text',
  nickname: 'text',
  title: 'text',
  company: 'text',
  location: 'text',
  kind: 'text',
  how_we_met: 'text',
  met_on: 'date',
  summary: 'text',
  website: 'text',
  linkedin_url: 'text',
  keep_in_touch_days: 'int',
  birthday: 'date',
  birthday_has_year: 'bool',
}

const updatePerson: Tool = {
  name: 'update_person',
  title: 'Update a person',
  description:
    "Change someone's details. Only the fields given change; give a field as null to clear it. " +
    'add_email / add_phone add to their list rather than replacing it; append_summary adds to the end of their summary.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string', description: 'From find_people.' },
      ...PERSON_FIELDS,
      add_email: { type: 'string' },
      email_label: { type: 'string', description: 'e.g. work, personal.' },
      add_phone: { type: 'string' },
      phone_label: { type: 'string', description: 'e.g. mobile, work.' },
      append_summary: { type: 'string', description: 'Text to add to the end of their summary.' },
    },
    required: ['person_id'],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(a, { tx }) {
    const pid = id(a, 'person_id')
    const fields = profileFields(a)
    const first = text(a, 'first_name', 100)
    if (first === null) throw new ToolError("first_name can't be cleared.")
    if (first !== undefined) fields.first_name = first
    const addEmail = text(a, 'add_email', 200)
    const addPhone = text(a, 'add_phone', 50)
    const appendSummary = text(a, 'append_summary', 4000)
    if (addEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail)) throw new ToolError('add_email should look like name@example.com.')

    const [before] = await tx`
      select id, first_name, last_name, nickname, title, company, location, kind, how_we_met, met_on::text as met_on,
             summary, website, linkedin_url, keep_in_touch_days, birthday::text as birthday, birthday_has_year, emails, phones
      from public.contacts where id = ${pid}`
    if (!before) throw new ToolError(`No person with id ${pid}. Look them up with find_people.`)

    if (appendSummary) fields.summary = before.summary ? `${before.summary}\n\n${appendSummary}` : appendSummary
    const emails = withValue(before.emails as Labeled[], addEmail, text(a, 'email_label', 30), () =>
      (before.emails as Labeled[]).length ? 'personal' : 'work')
    const phones = withValue(before.phones as Labeled[], addPhone, text(a, 'phone_label', 30), () => 'mobile')

    const changes: Record<string, { before: unknown; after: unknown }> = {}
    for (const [k, v] of Object.entries(fields)) {
      const was = before[k] ?? null
      if (String(was ?? '') !== String(v ?? '')) changes[k] = { before: was, after: v }
    }
    if (emails !== before.emails) changes.emails = { before: before.emails, after: emails }
    if (phones !== before.phones) changes.phones = { before: before.phones, after: phones }
    if (Object.keys(changes).length === 0) {
      return { summary: `Nothing to change for ${fullName(before as Person)}.`, data: { person_id: pid, changed: [] }, contactIds: [pid] }
    }

    for (const [k, { after }] of Object.entries(changes)) {
      if (k === 'emails' || k === 'phones') {
        await tx`update public.contacts set ${tx(k)} = ${tx.json(after as Labeled[])} where id = ${pid}`
      } else {
        const v = after === null ? null : String(after)
        await tx`update public.contacts set ${tx(k)} = ${v}::text::${tx.unsafe(COLUMN_TYPE[k])} where id = ${pid}`
      }
    }
    const [now] = await tx`select first_name, last_name from public.contacts where id = ${pid}`
    const changed = Object.keys(changes).filter((k) => k !== 'birthday_has_year')
    return {
      summary: `Updated ${fullName(now as Person)}: ${listNames(changed.map((k) => k.replace(/_/g, ' ')))}.`,
      data: { person_id: pid, changed },
      contactIds: [pid],
      changes,
    }
  },
}

const connectPeople: Tool = {
  name: 'connect_people',
  title: 'Connect two people',
  description:
    'Record that two people in the CRM know each other (they appear linked on the network graph), with an optional comment ' +
    'such as "worked together at Acme". If they are already connected, a new comment replaces the old one.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      other_person_id: { type: 'string' },
      comment: { type: 'string', description: 'How they know each other.' },
    },
    required: ['person_id', 'other_person_id'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(a, { tx }) {
    const one = id(a, 'person_id')
    const two = id(a, 'other_person_id')
    if (one === two) throw new ToolError("A person can't be connected to themselves.")
    const comment = text(a, 'comment', 1000)
    const [p1, p2] = await people(tx, [one, two])
    const both = `${fullName(p1)} and ${fullName(p2)}`

    const [existing] = await tx`
      select id, notes from public.relationships
      where (from_contact = ${one} and to_contact = ${two}) or (from_contact = ${two} and to_contact = ${one})`
    if (existing) {
      if (!comment || comment === existing.notes) {
        return { summary: `${both} were already connected.`, data: { connection_id: existing.id, created: false }, contactIds: [one, two] }
      }
      await tx`update public.relationships set notes = ${comment} where id = ${existing.id}`
      return {
        summary: `Updated how ${both} know each other.`,
        data: { connection_id: existing.id, created: false },
        contactIds: [one, two],
        changes: { comment: { before: existing.notes, after: comment } },
      }
    }
    const [r] = await tx`
      insert into public.relationships (from_contact, to_contact, notes) values (${one}, ${two}, ${comment ?? null}) returning id`
    return { summary: `Connected ${both}.`, data: { connection_id: r.id, created: true }, contactIds: [one, two] }
  },
}

const PEOPLE_PARAM = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'person_ids from find_people.' }
const WHEN_PARAM = {
  type: 'string',
  description: "When it happened, in the user's local time: YYYY-MM-DDTHH:MM, or YYYY-MM-DD / today / yesterday. Defaults to now.",
}

async function addEntry(
  tx: TransactionSql,
  timezone: string,
  e: { personIds: string[]; kind: string; when: string | null; title: string | null; location: string | null; notes: string | null; remember: string | null },
) {
  const who = await people(tx, e.personIds)
  const at = e.when ? await moment(tx, e.when, '12:00') : new Date()
  const [i] = await tx`
    insert into public.interactions (kind, happened_at, title, location, notes, remember)
    values (${e.kind}, ${at}, ${e.title}, ${e.location}, ${e.notes}, ${e.remember})
    returning id, happened_at`
  await tx`
    insert into public.interaction_participants (interaction_id, contact_id)
    select ${i.id}::uuid, x from unnest(${e.personIds}::uuid[]) as x`
  return { id: i.id as string, at: i.happened_at as Date, who, said: when(i.happened_at, timezone)! }
}

const logMeeting: Tool = {
  name: 'log_meeting',
  title: 'Log a meeting, call or message',
  description:
    "Add a meeting, call, email, message or event to the timeline of everyone who was there, with notes and the key points " +
    'to remember. Optionally add a follow-up reminder tied to it.',
  inputSchema: {
    type: 'object',
    properties: {
      person_ids: PEOPLE_PARAM,
      kind: { type: 'string', enum: KINDS, default: 'meeting' },
      when: WHEN_PARAM,
      title: { type: 'string', description: 'Short, e.g. "Coffee" or "Quarterly review".' },
      location: { type: 'string' },
      notes: { type: 'string', description: 'What happened.' },
      key_points: { type: 'string', description: 'Takeaways and things to remember — promises made, names, next steps.' },
      follow_up: {
        type: 'object',
        description: 'A reminder to follow up.',
        properties: {
          title: { type: 'string', description: 'e.g. "Send Sarah the deck".' },
          due: { type: 'string', description: "YYYY-MM-DDTHH:MM or YYYY-MM-DD (9am), user's local time." },
          notes: { type: 'string' },
        },
        required: ['title', 'due'],
      },
    },
    required: ['person_ids'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const personIds = ids(a, 'person_ids')
    const kind = oneOf(a, 'kind', KINDS) ?? 'meeting'
    const fu = a.follow_up
    let followUp: { title: string; due: string; notes: string | null } | null = null
    if (fu !== undefined && fu !== null) {
      if (typeof fu !== 'object' || Array.isArray(fu)) throw new ToolError('follow_up should be an object with title and due.')
      followUp = { title: required(fu as Args, 'title', 200), due: required(fu as Args, 'due', 40), notes: text(fu as Args, 'notes', 2000) ?? null }
    }
    const e = await addEntry(tx, timezone, {
      personIds,
      kind,
      when: text(a, 'when', 40) ?? null,
      title: text(a, 'title', 200) ?? null,
      location: text(a, 'location', 200) ?? null,
      notes: text(a, 'notes', 20000) ?? null,
      remember: text(a, 'key_points', 5000) ?? null,
    })

    let reminder: { reminder_id: string; due: string } | null = null
    if (followUp) {
      const due = await moment(tx, followUp.due, '09:00')
      const [r] = await tx`
        insert into public.reminders (title, due_at, notes, contact_id, interaction_id)
        values (${followUp.title}, ${due}, ${followUp.notes}, ${personIds[0]}, ${e.id}) returning id`
      reminder = { reminder_id: r.id, due: when(due, timezone)! }
    }
    const names = listNames(e.who.map(fullName))
    return {
      summary:
        `Logged ${KIND_WORD[kind]} with ${names} on ${e.said}.` +
        (reminder ? ` Follow-up "${followUp!.title}" set for ${reminder.due}.` : ''),
      data: { entry_id: e.id, when: e.said, follow_up: reminder },
      contactIds: personIds,
    }
  },
}

const addNote: Tool = {
  name: 'add_note',
  title: 'Add a note',
  description:
    "Add a note to one or more people's timelines — something learned or worth remembering that wasn't a meeting. " +
    'For a lasting fact shown on their profile (e.g. "Kids: Emma and Jack"), use add_detail instead.',
  inputSchema: {
    type: 'object',
    properties: {
      person_ids: PEOPLE_PARAM,
      text: { type: 'string' },
      title: { type: 'string' },
      when: WHEN_PARAM,
    },
    required: ['person_ids', 'text'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const e = await addEntry(tx, timezone, {
      personIds: ids(a, 'person_ids'),
      kind: 'note',
      when: text(a, 'when', 40) ?? null,
      title: text(a, 'title', 200) ?? null,
      location: null,
      notes: required(a, 'text', 20000),
      remember: null,
    })
    return {
      summary: `Added a note to ${listNames(e.who.map(fullName))}'s timeline.`,
      data: { entry_id: e.id, when: e.said },
      contactIds: e.who.map((p) => p.id),
    }
  },
}

const updateEntry: Tool = {
  name: 'update_meeting',
  title: 'Update a meeting or note',
  description:
    'Change a timeline entry (meeting, call, note…) found with get_person or list_timeline. Only the fields given change. ' +
    'Prefer append_notes / append_key_points to add to what is there; notes / key_points replace it. add_person_ids adds people who were also there.',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: { type: 'string', description: 'From get_person or list_timeline.' },
      kind: { type: 'string', enum: [...KINDS, 'note'] },
      when: WHEN_PARAM,
      title: { type: 'string' },
      location: { type: 'string' },
      notes: { type: 'string', description: 'Replaces the notes.' },
      append_notes: { type: 'string', description: 'Added to the end of the notes.' },
      key_points: { type: 'string', description: 'Replaces the key points.' },
      append_key_points: { type: 'string', description: 'Added to the end of the key points.' },
      add_person_ids: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    },
    required: ['entry_id'],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(a, { tx, timezone }) {
    const eid = id(a, 'entry_id')
    const [before] = await tx`
      select id, kind, happened_at, title, location, notes, remember from public.interactions where id = ${eid}`
    if (!before) throw new ToolError(`No timeline entry with id ${eid}. Find it with list_timeline or get_person.`)

    const next: Record<string, unknown> = {}
    const kind = oneOf(a, 'kind', [...KINDS, 'note'] as const)
    if (kind) next.kind = kind
    const w = text(a, 'when', 40)
    if (w) next.happened_at = await moment(tx, w, '12:00')
    const title = text(a, 'title', 200)
    if (title !== undefined) next.title = title
    const location = text(a, 'location', 200)
    if (location !== undefined) next.location = location
    const join = (old: string | null, add: string) => (old ? `${old}\n\n${add}` : add)
    const notes = text(a, 'notes', 20000)
    const appendNotes = text(a, 'append_notes', 20000)
    if (notes !== undefined) next.notes = notes
    if (appendNotes) next.notes = join((next.notes as string | null | undefined) ?? before.notes, appendNotes)
    const keyPoints = text(a, 'key_points', 5000)
    const appendKeyPoints = text(a, 'append_key_points', 5000)
    if (keyPoints !== undefined) next.remember = keyPoints
    if (appendKeyPoints) next.remember = join((next.remember as string | null | undefined) ?? before.remember, appendKeyPoints)
    const adding = given(a, 'add_person_ids') && a.add_person_ids !== null ? ids(a, 'add_person_ids') : []

    const changes: Record<string, { before: unknown; after: unknown }> = {}
    for (const [k, v] of Object.entries(next)) {
      const was = before[k] ?? null
      const same = v instanceof Date ? was instanceof Date && v.getTime() === was.getTime() : (was ?? null) === (v ?? null)
      if (!same) changes[k === 'remember' ? 'key_points' : k === 'happened_at' ? 'when' : k] = { before: was, after: v }
    }

    if (changes.kind) await tx`update public.interactions set kind = ${next.kind as string} where id = ${eid}`
    if (changes.when) await tx`update public.interactions set happened_at = ${next.happened_at as Date} where id = ${eid}`
    if (changes.title) await tx`update public.interactions set title = ${next.title as string | null} where id = ${eid}`
    if (changes.location) await tx`update public.interactions set location = ${next.location as string | null} where id = ${eid}`
    if (changes.notes) await tx`update public.interactions set notes = ${next.notes as string | null} where id = ${eid}`
    if (changes.key_points) await tx`update public.interactions set remember = ${next.remember as string | null} where id = ${eid}`

    let added: Person[] = []
    if (adding.length) {
      added = await people(tx, adding)
      const fresh = await tx`
        insert into public.interaction_participants (interaction_id, contact_id)
        select ${eid}::uuid, x from unnest(${adding}::uuid[]) as x
        on conflict do nothing returning contact_id`
      added = added.filter((p) => fresh.some((f) => f.contact_id === p.id))
      if (added.length) changes.people_added = { before: null, after: added.map(fullName) }
    }

    const participants = await tx<{ contact_id: string }[]>`
      select contact_id from public.interaction_participants where interaction_id = ${eid}`
    const changed = Object.keys(changes)
    const dated = when((next.happened_at as Date | undefined) ?? before.happened_at, timezone)
    return {
      summary: changed.length
        ? `Updated the ${before.kind}${before.title ? ` "${before.title}"` : ''} on ${dated}: ${listNames(changed.map((k) => k.replace(/_/g, ' ')))}.`
        : 'Nothing to change on that entry.',
      data: { entry_id: eid, changed },
      contactIds: participants.map((p) => p.contact_id),
      changes: changed.length ? changes : undefined,
    }
  },
}

const addDetail: Tool = {
  name: 'add_detail',
  title: 'Add a detail to a profile',
  description:
    'Add a lasting fact to someone\'s profile under "Details & facts" — e.g. label "Kids", value "Emma (8) and Jack (5)"; ' +
    'label "Coffee", value "Flat white". For something that happened, use add_note or log_meeting.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      label: { type: 'string', description: 'A short heading, e.g. "Kids", "Allergies", "Favourite team".' },
      value: { type: 'string' },
    },
    required: ['person_id', 'label', 'value'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(a, { tx }) {
    const pid = id(a, 'person_id')
    const lbl = required(a, 'label', 60)
    const value = required(a, 'value', 2000)
    const p = await person(tx, pid)
    const [dupe] = await tx`
      select id from public.facts where contact_id = ${pid} and lower(label) = lower(${lbl}) and lower(value) = lower(${value})`
    if (dupe) return { summary: `${fullName(p)}'s profile already has that.`, data: { detail_id: dupe.id, added: false }, contactIds: [pid] }
    const [f] = await tx`insert into public.facts (contact_id, label, value) values (${pid}, ${lbl}, ${value}) returning id`
    return { summary: `Added "${lbl}: ${value}" to ${fullName(p)}'s profile.`, data: { detail_id: f.id, added: true }, contactIds: [pid] }
  },
}

export const TOOLS: Tool[] = [
  findPeople,
  getPerson,
  listTimeline,
  addPerson,
  updatePerson,
  connectPeople,
  logMeeting,
  addNote,
  updateEntry,
  addDetail,
]
