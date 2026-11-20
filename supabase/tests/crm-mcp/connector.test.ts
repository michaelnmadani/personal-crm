// End-to-end tests of the crm-mcp connector against a local copy of the CRM
// database (all repo migrations, real row-level security). See reset-db.sh for how to run.
import postgres from 'npm:postgres@3.4.5'
import { createHandler } from '../../functions/crm-mcp/mcp.ts'

const db = postgres('postgres://postgres:local@127.0.0.1:5432/crm', { prepare: false, max: 4, onnotice: () => {} })
const handle = createHandler(db)

const ME = '11111111-1111-1111-1111-111111111111'
const DEMO = 'cbb8e3e1-f87d-4003-b9e5-c7f6bc536b32'
const STRANGER = '22222222-2222-2222-2222-222222222222'

let failures = 0
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`)
  if (!cond) failures++
}
const section = (s: string) => console.log(`\n${s}`)

async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------------ seed
const contact = async (user: string, first: string, last: string | null, extra: Record<string, unknown> = {}) => {
  const [r] = await db`insert into public.contacts ${db({ user_id: user, first_name: first, last_name: last, ...extra })} returning id`
  return r.id as string
}
const sarahL = await contact(ME, 'Sarah', 'Little', { company: 'Acme', title: 'Director' })
const sarahT = await contact(ME, 'Sarah', 'Thornely', { company: 'Beta Corp' })
const jason = await contact(ME, 'Jason', 'Miller')
const akanksha = await contact(ME, 'Akanksha', 'Wangnoo')
await contact(DEMO, 'Scrooge', 'McDuck')
const secret = await contact(STRANGER, 'Sarah', 'Secret')
await db`insert into public.relationships (user_id, from_contact, to_contact, notes) values (${ME}, ${sarahL}, ${jason}, 'Old colleagues')`
const [past] = await db`insert into public.interactions (user_id, kind, happened_at, title, notes) values (${ME}, 'meeting', now() - interval '1 day', 'Coffee', 'Talked about the merger') returning id`
await db`insert into public.interaction_participants (user_id, interaction_id, contact_id) values (${ME}, ${past.id}, ${sarahL})`

const keys = { me: 'pcrm_test_me', demo: 'pcrm_test_demo', stranger: 'pcrm_test_stranger', revoked: 'pcrm_test_revoked' }
const [meKey] = await db`insert into public.api_tokens (user_id, label, token_hash, timezone) values (${ME}, 'Muse', ${await hash(keys.me)}, 'Australia/Sydney') returning id`
await db`insert into public.api_tokens (user_id, label, token_hash) values (${DEMO}, 'Demo', ${await hash(keys.demo)})`
await db`insert into public.api_tokens (user_id, label, token_hash) values (${STRANGER}, 'Other', ${await hash(keys.stranger)})`
await db`insert into public.api_tokens (user_id, label, token_hash, revoked_at) values (${ME}, 'Old', ${await hash(keys.revoked)}, now())`

// --------------------------------------------------------------- helpers
let nextId = 1
async function post(body: unknown, key: string | null = keys.me, method = 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (key) headers.authorization = `Bearer ${key}`
  const res = await handle(new Request('http://local/crm-mcp', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }))
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}
async function call(name: string, args: Record<string, unknown>, key = keys.me) {
  const r = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, key)
  const result = r.body.result
  if (!result) throw new Error(`no result: ${JSON.stringify(r.body)}`)
  return { error: !!result.isError, text: result.content[0].text as string, data: result.structuredContent as any }
}

// ------------------------------------------------------------- protocol
section('Protocol')
{
  const none = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null)
  ok(none.status === 401 && /Bearer/.test(none.headers.get('www-authenticate') ?? ''), 'no key → 401 with a Bearer challenge')
  ok((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'pcrm_wrong')).status === 401, 'wrong key → 401')
  ok((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, keys.revoked)).status === 401, 'revoked key → 401')
  ok((await post(null, keys.me, 'GET')).status === 405, 'GET → 405 (no event stream offered)')

  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse', version: '1' } } })
  ok(init.body.result.protocolVersion === '2025-06-18', 'initialize agrees the version asked for')
  ok(init.body.result.capabilities.tools && /Australia\/Sydney/.test(init.body.result.instructions), 'offers tools, with instructions naming the time zone')
  const odd = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
  ok(PROTOCOL_OK(odd.body.result.protocolVersion), `unknown version → falls back to a supported one (${odd.body.result.protocolVersion})`)
  ok((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status === 202, 'notification → 202, no body')

  const list = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
  const tools = list.body.result.tools as any[]
  ok(tools.length === 10, `lists 10 tools: ${tools.map((t) => t.name).join(', ')}`)
  ok(tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).join() === 'find_people,get_person,list_timeline', 'the three readers are marked read-only')
  ok(tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name).join() === 'update_person,update_meeting', 'only the two editors are marked as changing existing data')
  ok(!tools.some((t) => /delete|remove/.test(t.name)), 'no tool deletes anything')

  ok((await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'drop_everything', arguments: {} } })).body.error.code === -32602, 'unknown tool → -32602')
  ok((await post({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).body.error.code === -32601, 'unsupported method → -32601')
  const bad = await handle(new Request('http://local', { method: 'POST', headers: { authorization: `Bearer ${keys.me}` }, body: '{oops' }))
  ok(bad.status === 400 && (await bad.json()).error.code === -32700, 'malformed JSON → -32700')
  const batch = await post([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'ping' }])
  ok(Array.isArray(batch.body) && batch.body.length === 2, 'batch → one reply per request, none for the notification')
}
function PROTOCOL_OK(v: string) {
  return ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(v)
}

// ------------------------------------------------------------------ reads
section('Finding and reading people')
{
  const sarahs = await call('find_people', { name: 'Sarah' })
  ok(sarahs.data.results.length === 2, `"Sarah" → both of my Sarahs, not the stranger's (${sarahs.text.split('\n')[0]})`)
  const thornley = await call('find_people', { name: 'Sarah Thornley' })
  ok(thornley.data.results[0]?.person_id === sarahT, 'misspelt "Sarah Thornley" → Sarah Thornely first')
  const dictated = await call('find_people', { name: 'a conscious wang new' })
  ok(dictated.data.results[0]?.person_id === akanksha, 'dictation-mangled "a conscious wang new" → Akanksha Wangnoo')
  const acme = await call('find_people', { company: 'acme' })
  ok(acme.data.results.length === 1 && acme.data.results[0].person_id === sarahL, 'company "acme" → Sarah Little')
  const nobody = await call('find_people', { name: 'Zebedee' })
  ok(nobody.data.results.length === 0 && /No one/.test(nobody.text), 'no match → says so')

  const p = await call('get_person', { person_id: sarahL })
  ok(/^Sarah Little, Director at Acme\. Last in touch/.test(p.text), `get_person speaks a summary: "${p.text.split('\n')[0]}"`)
  ok(p.data.connections[0]?.name === 'Jason Miller' && p.data.connections[0]?.comment === 'Old colleagues', 'includes connections with their comment')
  ok(p.data.recent_timeline[0]?.entry_id === past.id, 'includes recent timeline entries with ids')
  const theirs = await call('get_person', { person_id: secret })
  ok(theirs.error && /No person/.test(theirs.text), "another account's contact id → not found")
  const junk = await call('get_person', { person_id: 'not-an-id' })
  ok(junk.error && /should be a person or entry id/.test(junk.text), 'a malformed id → a correctable message')
}

// ----------------------------------------------------------------- people
section('Adding and updating people')
let gyro = ''
{
  const dup = await call('add_person', { first_name: 'sarah', last_name: 'little' })
  ok(!dup.error && dup.data.added === false && dup.data.existing[0].person_id === sarahL, 'adding an existing name → not added, existing match returned')
  const twin = await call('add_person', { first_name: 'Sarah', last_name: 'Little', company: 'Other Co', allow_duplicate: true })
  ok(twin.data.added === true, 'allow_duplicate → added anyway')

  const g = await call('add_person', {
    first_name: 'Gyro', last_name: 'Gearloose', company: 'Gearloose Labs', title: 'Inventor', email: 'gyro@labs.example',
    phone: '0400 000 000', met_on: 'yesterday', how_we_met: 'Duckburg tech meetup', website: 'gearloose.example',
  })
  gyro = g.data.person_id
  ok(g.text.startsWith('Added Gyro Gearloose, Inventor at Gearloose Labs.'), `add_person → "${g.text.split('\n')[0]}"`)
  const [row] = await db`select user_id, kind, emails, phones, met_on::text, website from public.contacts where id = ${gyro}`
  ok(row.user_id === ME && row.kind === 'business', 'stored against my account, kind defaulted to business')
  ok(row.emails[0].value === 'gyro@labs.example' && row.emails[0].label === 'work' && row.phones[0].label === 'mobile', 'email and phone stored the way the app stores them')
  ok(row.website === 'https://gearloose.example/', 'a bare website gets https://')
  const [{ y }] = await db`select (now() at time zone 'Australia/Sydney')::date - 1 as y`
  ok(row.met_on === new Date(y).toISOString().slice(0, 10) || row.met_on === String(y).slice(0, 10), `"yesterday" read in Sydney time (${row.met_on})`)

  const u = await call('update_person', {
    person_id: sarahL, company: 'Acme Global', add_email: 'sarah@acme.example', append_summary: 'Moving to Sydney in March.', birthday: '03-15', nickname: null,
  })
  ok(!u.error && /^Updated Sarah Little: /.test(u.text) && ['company', 'summary', 'birthday', 'emails'].every((w) => u.text.split('\n')[0].includes(w)) && !/nickname/.test(u.text.split('\n')[0]), `update_person → "${u.text.split('\n')[0]}"`)
  const [s] = await db`select company, summary, birthday::text, birthday_has_year, emails from public.contacts where id = ${sarahL}`
  ok(s.company === 'Acme Global' && s.summary === 'Moving to Sydney in March.' && s.birthday === '2000-03-15' && s.birthday_has_year === false, 'fields changed; a birthday without a year stored the app\'s way')
  const [log] = await db`select changes from public.assistant_log where tool = 'update_person' order by created_at desc limit 1`
  ok(log.changes.company.before === 'Acme' && log.changes.company.after === 'Acme Global', 'activity log keeps the value it replaced')
  const again = await call('update_person', { person_id: sarahL, company: 'Acme Global' })
  ok(/Nothing to change/.test(again.text), 'an update that changes nothing says so')
  const xss = await call('update_person', { person_id: sarahL, linkedin_url: 'javascript:alert(1)' })
  ok(xss.error && /http or https/.test(xss.text), 'a javascript: link is refused')
  const clear = await call('update_person', { person_id: sarahL, first_name: null })
  ok(clear.error && /can't be cleared/.test(clear.text), "first name can't be cleared")
}

// ------------------------------------------------------------ connections
section('Connections')
{
  const c = await call('connect_people', { person_id: sarahT, other_person_id: gyro, comment: 'Met at the meetup' })
  ok(c.text.startsWith('Connected Sarah Thornely and Gyro Gearloose.'), 'connect_people → connected')
  const again = await call('connect_people', { person_id: gyro, other_person_id: sarahT })
  ok(/already connected/.test(again.text), 'the same pair the other way round → already connected, no second link')
  const recomment = await call('connect_people', { person_id: gyro, other_person_id: sarahT, comment: 'Co-founders' })
  ok(/Updated how/.test(recomment.text), 'a new comment updates the existing link')
  const [{ n }] = await db`select count(*)::int as n from public.relationships where (from_contact = ${sarahT} and to_contact = ${gyro}) or (from_contact = ${gyro} and to_contact = ${sarahT})`
  ok(n === 1, 'exactly one link between them')
  ok((await call('connect_people', { person_id: gyro, other_person_id: gyro })).error, "can't connect someone to themselves")
  const cross = await call('connect_people', { person_id: gyro, other_person_id: secret })
  ok(cross.error && /No person/.test(cross.text), "can't link to another account's contact")
}

// --------------------------------------------------------------- meetings
section('Meetings and notes')
let meeting = ''
{
  const m = await call('log_meeting', {
    person_ids: [sarahL, jason], kind: 'meeting', when: '2026-11-20T09:30', title: 'Coffee', location: 'Bills Surry Hills',
    notes: 'Catch-up on the merger.', key_points: 'Sarah is hiring two engineers.',
    follow_up: { title: 'Send Sarah the deck', due: '2026-11-24' },
  })
  meeting = m.data.entry_id
  ok(m.text.startsWith('Logged a meeting with Sarah Little and Jason Miller on Fri, 20 Nov 2026, 9:30 am.'), `log_meeting → "${m.text.split('\n')[0]}"`)
  const [i] = await db`select kind, happened_at, remember, user_id from public.interactions where id = ${meeting}`
  ok(i.happened_at.toISOString() === '2026-11-19T22:30:00.000Z', '9:30 with no offset stored as 9:30 Sydney time')
  ok(i.remember === 'Sarah is hiring two engineers.' && i.user_id === ME, 'key points stored as the entry\'s "remember"')
  const [{ n: who }] = await db`select count(*)::int as n from public.interaction_participants where interaction_id = ${meeting}`
  ok(who === 2, 'on both people\'s timelines')
  const [r] = await db`select due_at, contact_id, interaction_id from public.reminders where interaction_id = ${meeting}`
  ok(r && r.due_at.toISOString() === '2026-11-23T22:00:00.000Z' && r.contact_id === sarahL, 'follow-up due 9am Sydney on the day, tied to the meeting')

  const before = (await db`select count(*)::int as n from public.interactions`)[0].n
  const bad = await call('log_meeting', { person_ids: [sarahL], when: 'next Tuesday' })
  ok(bad.error && /couldn't read "next Tuesday"/.test(bad.text), 'an unreadable time → asks for a proper one')
  const half = await call('log_meeting', { person_ids: [sarahL, secret], title: 'Should not save' })
  ok(half.error, "a meeting naming another account's contact is refused")
  const after = (await db`select count(*)::int as n from public.interactions`)[0].n
  ok(before === after, 'and nothing half-saved: no stray meeting left behind')

  const note = await call('add_note', { person_ids: [akanksha], text: 'Moving to the Sydney office in January.' })
  ok(note.text.startsWith("Added a note to Akanksha Wangnoo's timeline."), 'add_note → note on the timeline')
  const [k] = await db`select kind from public.interactions where id = ${note.data.entry_id}`
  ok(k.kind === 'note', 'stored as a timeline note')

  const up = await call('update_meeting', { entry_id: meeting, append_notes: 'She also mentioned the Melbourne office.', add_person_ids: [gyro], when: '2026-11-20T10:00' })
  ok(!up.error && /notes/.test(up.text) && /people added/.test(up.text) && /when/.test(up.text), `update_meeting → "${up.text.split('\n')[0]}"`)
  const [m2] = await db`select notes, happened_at from public.interactions where id = ${meeting}`
  ok(m2.notes === 'Catch-up on the merger.\n\nShe also mentioned the Melbourne office.', 'append_notes adds to the notes, keeping what was there')
  ok(m2.happened_at.toISOString() === '2026-11-19T23:00:00.000Z', 'time moved to 10:00 Sydney')
  const notMine = await call('update_meeting', { entry_id: (await db`insert into public.interactions (user_id, title) values (${STRANGER}, 'theirs') returning id`)[0].id, title: 'hijacked' })
  ok(notMine.error && /No timeline entry/.test(notMine.text), "another account's entry can't be edited")

  const tl = await call('list_timeline', { person_id: sarahL })
  ok(tl.data.entries.length === 2 && tl.data.entries[0].entry_id === meeting, 'list_timeline → her entries, newest first, with everyone on each')

  const d = await call('add_detail', { person_id: jason, label: 'Coffee', value: 'Flat white' })
  ok(d.text === 'Added "Coffee: Flat white" to Jason Miller\'s profile.' || d.text.startsWith('Added "Coffee: Flat white"'), 'add_detail → on the profile')
  const d2 = await call('add_detail', { person_id: jason, label: 'coffee', value: 'flat white' })
  ok(d2.data.added === false, 'the same detail twice → not repeated')
}

// ---------------------------------------------------------- other accounts
section('Other accounts')
{
  const demoRead = await call('find_people', { name: 'Scrooge' }, keys.demo)
  ok(demoRead.data.results.length === 1, 'the demo key can read the demo account')
  const demoWrite = await call('add_person', { first_name: 'Vandal' }, keys.demo)
  ok(demoWrite.error && /read-only/.test(demoWrite.text), `but can't write: the demo stays read-only (${demoWrite.text})`)
  const theirs = await call('find_people', { name: 'Sarah' }, keys.stranger)
  ok(theirs.data.results.length === 1 && theirs.data.results[0].person_id === secret, "a stranger's key finds only their own Sarah")

  // As a browser session would: the log and keys are private, and the demo can't make keys.
  const asUser = (uid: string) => db.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: uid })}, true)`
    const [{ logs }] = await tx`select count(*)::int as logs from public.assistant_log`
    const [{ tokens }] = await tx`select count(*)::int as tokens from public.api_tokens`
    return { logs, tokens }
  })
  const mine = await asUser(ME)
  const strangers = await asUser(STRANGER)
  ok(mine.logs > 10 && mine.tokens === 2, `I see my own activity (${mine.logs} lines) and my 2 keys`)
  ok(strangers.tokens === 1, "a stranger sees only their own key, none of mine")
  const demoKey = await db.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: DEMO })}, true)`
    await tx`insert into public.api_tokens (label, token_hash) values ('x', ${'a'.repeat(64)})`
  }).then(() => 'made', (e) => e.code)
  ok(demoKey === '42501', 'the demo account cannot create a key')
  const browserLog = await db.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: ME })}, true)`
    await tx`insert into public.assistant_log (user_id, tool, ok, summary) values (${ME}, 'x', true, 'forged')`
  }).then(() => 'written', (e) => e.code)
  ok(browserLog === '42501', 'the activity log cannot be written from a browser session')
  const [{ used }] = await db`select last_used_at is not null as used from public.api_tokens where id = ${meKey.id}`
  ok(used, 'the key records when it was last used')
}

await db.end()
console.log(failures ? `\n${failures} FAILED` : '\nALL CONNECTOR CHECKS PASSED')
Deno.exit(failures ? 1 : 0)
