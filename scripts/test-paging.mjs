// Checks that whole-table reads, the backup export and the LinkedIn import
// duplicate check get every row, not just the first 1000. Runs the app's real
// data layer (src/lib/hooks.ts) against a stand-in for Supabase's REST server
// that caps responses at 1000 rows, as the real one does.
//
//   node scripts/test-paging.mjs
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = join(mkdtempSync(join(tmpdir(), 'crm-paging-')), 'hooks.mjs')
const entry = join(root, 'scripts', '.paging-entry.ts')
writeFileSync(entry, `export { api, fetchAll } from '../src/lib/hooks'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'warning',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://127.0.0.1:54329"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test-key"' },
}).finally(() => import('node:fs').then((fs) => fs.rmSync(entry)))

const CAP = 1000
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const db = {
  contacts: many(1500, (i) => ({ id: uuid(i), first_name: `Person${i}`, last_name: 'Test', company: 'Co', linkedin_url: null, archived: false })),
  contacts_overview: [],
  family_members: many(45, (i) => ({ id: uuid(i) })),
  facts: many(53, (i) => ({ id: uuid(i) })),
  work_history: many(1234, (i) => ({ id: uuid(i) })),
  interactions: many(2000, (i) => ({ id: uuid(i) })), // exactly two full pages
  interaction_participants: many(592, (i) => ({ interaction_id: uuid(i), contact_id: uuid(i) })),
  reminders: many(37, (i) => ({ id: uuid(i) })),
  relationships: many(2500, (i) => ({ id: uuid(i) })),
  groups: [], group_members: many(248, (i) => ({ group_id: uuid(1), contact_id: uuid(i) })),
  group_companies: [], tags: [],
  contact_tags: many(1042, (i) => ({ contact_id: uuid(i), tag_id: uuid(1) })),
  capture_drafts: many(1, (i) => ({ id: uuid(i) })), capture_aliases: [],
}
db.contacts_overview = db.contacts
const seen = []
let next = 1e6

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const table = url.pathname.replace('/rest/v1/', '')
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })
  const one = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const send = (rows) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(one ? rows[0] ?? null : rows))
  }
  if (req.method === 'GET') {
    const order = url.searchParams.get('order')
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? CAP), CAP)
    seen.push({ table, order, offset, limit })
    let rows = db[table] ?? []
    const nameFilter = url.searchParams.get('name')
    if (nameFilter?.startsWith('ilike.')) rows = rows.filter((r) => r.name?.toLowerCase() === nameFilter.slice(6).toLowerCase())
    return send(rows.slice(offset, offset + limit))
  }
  if (req.method === 'POST') {
    const input = JSON.parse(body)
    const created = (Array.isArray(input) ? input : [input]).map((r) => ({ id: uuid(next++), ...r }))
    ;(db[table] ??= []).push(...created)
    return send(created)
  }
  res.statusCode = 405
  res.end()
})
await new Promise((r) => server.listen(54329, '127.0.0.1', r))

const { api, fetchAll } = await import(pathToFileURL(bundle).href)
let failures = 0
const ok = (c, m) => { console.log(`${c ? '  ok  ' : '  FAIL'} ${m}`); if (!c) failures++ }

console.log('Backup export')
const out = await api.exportAll()
for (const [t, rows] of Object.entries(db)) {
  if (t === 'contacts_overview') continue
  ok(out[t]?.length === rows.length, `${t}: ${out[t]?.length} of ${rows.length}`)
}
ok(new Set(out.relationships.map((r) => r.id)).size === 2500, 'no row repeated across pages')
ok(out.counts.contacts === 1500 && out.counts.relationships === 2500, 'counts reported for the on-screen message')
const pages = (t) => seen.filter((s) => s.table === t)
ok(pages('interactions').length === 3, 'exactly two full pages → asks a third time, gets nothing, stops')
ok(pages('facts').length === 1, 'a small table is one request')
ok(pages('contact_tags').every((s) => s.order === 'contact_id.asc,tag_id.asc'), 'contact_tags ordered by its full key, so pages never overlap')
ok(pages('interaction_participants').every((s) => s.order === 'interaction_id.asc,contact_id.asc'), 'interaction_participants ordered by its full key')
ok(pages('relationships').every((s) => s.order === 'id.asc'), 'relationships ordered by id')

console.log('\nLinkedIn import duplicate check')
seen.length = 0
const before = db.contacts.length
const r = await api.importContacts({
  rows: [
    { first_name: 'Person1400', last_name: 'Test', company: 'Co', title: null, linkedin_url: null, emails: [], met_on: null, how_we_met: null },
    { first_name: 'Brand', last_name: 'New', company: 'Co', title: null, linkedin_url: null, emails: [], met_on: null, how_we_met: null },
  ],
})
ok(r.inserted === 1 && r.skipped === 1, `someone past the first 1000 is recognised as already there (inserted ${r.inserted}, skipped ${r.skipped})`)
ok(db.contacts.length === before + 1, 'only the new person was added')
ok(pages('contacts').length === 2, 'read all existing contacts across 2 pages')

console.log('\nfetchAll edge cases')
seen.length = 0
const none = await fetchAll((from, to) => ({ then: (res) => res({ data: [], error: null }) }))
ok(Array.isArray(none) && none.length === 0, 'an empty table → []')
let err
await fetchAll(() => Promise.resolve({ data: null, error: { message: 'boom' } })).catch((e) => (err = e))
ok(err?.message === 'boom', 'an error on any page is thrown, not swallowed as a short page')

server.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PAGING CHECKS PASSED')
process.exit(failures ? 1 : 0)
