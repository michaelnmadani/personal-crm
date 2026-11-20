/**
 * A Model Context Protocol server for the CRM, over Streamable HTTP — the kind
 * of address Meta's Muse, Claude and ChatGPT accept as a custom connector.
 *
 * Stateless: every request carries its access key, every reply is plain JSON
 * (the protocol allows that in place of an event stream), and no session is
 * kept between calls.
 */
import type { Sql } from 'npm:postgres@3.4.5'
import { TOOLS, ToolError, type ToolResult } from './tools.ts'

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'personal-crm', title: 'Personal CRM', version: '1.0.0' }
const MAX_BODY = 1_000_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type Key = { id: string; user_id: string; timezone: string }

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...headers } })

const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function fingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function validZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'Australia/Sydney'
  }
}

const instructions = (tz: string) =>
  [
    "This is the user's personal CRM: the people they know, the connections between those people, and a timeline of " +
      'meetings, calls, messages and notes for each person.',
    'Always find people with find_people and use the person_id it returns — never guess an id. ' +
      'Check find_people before add_person so no one is added twice. If several people match, ask the user which one.',
    `Times are the user's local time (${tz}) unless they include an offset. Dates can be YYYY-MM-DD, today or yesterday.`,
    'Nothing can be deleted through this connector; if the user wants something removed, tell them to do it in the app.',
    'The user is often speaking rather than reading, so confirm what was saved in a sentence.',
  ].join('\n')

/** What went wrong, in words the assistant can act on — never a raw database error. */
function explain(e: unknown): string {
  if (e instanceof ToolError) return e.message
  const code = (e as { code?: string })?.code
  if (code === '42501') return "That isn't allowed for this account. (The public demo account is read-only.)"
  if (code === '23503') return "Something this refers to doesn't exist any more. Look the person up again with find_people."
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008' || code === '22023') {
    return `One of the values isn't in a form the CRM accepts (${(e as Error).message}).`
  }
  console.error('crm-mcp tool failure', e)
  return 'Something went wrong and nothing was saved. Try again in a moment.'
}

export function createHandler(sql: Sql) {
  async function keyFor(req: Request): Promise<Key | null> {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') ?? '')
    if (!m) return null
    const [k] = await sql<Key[]>`
      select id, user_id, timezone from public.api_tokens
      where token_hash = ${await fingerprint(m[1])} and revoked_at is null`
    return k ?? null
  }

  async function callTool(key: Key, name: string, args: Record<string, unknown>) {
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return null
    const timezone = validZone(key.timezone)
    let out: ToolResult | null = null
    let message: string
    try {
      out = await sql.begin(async (tx) => {
        // Act as the key's owner, under the same row-level security as the app.
        await tx`
          select set_config('role', 'authenticated', true),
                 set_config('request.jwt.claims', ${JSON.stringify({ sub: key.user_id, role: 'authenticated' })}, true),
                 set_config('request.jwt.claim.sub', ${key.user_id}, true),
                 set_config('timezone', ${timezone}, true)`
        return await tool.run(args, { tx, timezone })
      })
      message = out.summary
    } catch (e) {
      message = explain(e)
    }

    // A line in the owner's activity log, written after (and outside) the
    // change itself, so a logging hiccup can never undo what was saved.
    await sql`
      insert into public.assistant_log (user_id, token_id, tool, ok, summary, contact_ids, changes)
      values (${key.user_id}, ${key.id}, ${name}, ${out !== null}, ${message.slice(0, 500)},
              ${out?.contactIds ?? []}::uuid[], ${out?.changes ? sql.json(out.changes as never) : null})`.catch((e) =>
      console.error('crm-mcp log failure', e),
    )
    await sql`update public.api_tokens set last_used_at = now() where id = ${key.id}`.catch(() => undefined)

    if (!out) return { content: [{ type: 'text', text: message }], isError: true }
    return {
      content: [{ type: 'text', text: `${out.summary}\n\n${JSON.stringify(out.data)}` }],
      structuredContent: out.data,
    }
  }

  async function answer(key: Key, msg: Rpc): Promise<object | null> {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request')
    const isNotification = msg.id === undefined || msg.id === null
    const p = msg.params ?? {}

    switch (msg.method) {
      case 'initialize': {
        const asked = String(p.protocolVersion ?? '')
        const result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: instructions(validZone(key.timezone)),
        }
        return { jsonrpc: '2.0', id: msg.id, result }
      }
      case 'ping':
        return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result: {} }
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
              name,
              title,
              description,
              inputSchema,
              annotations: { title, ...annotations },
            })),
          },
        }
      case 'tools/call': {
        const name = String(p.name ?? '')
        const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {}
        const result = await callTool(key, name, args)
        if (!result) return rpcError(msg.id, -32602, `Unknown tool: ${name}`)
        return { jsonrpc: '2.0', id: msg.id, result }
      }
      default:
        if (isNotification) return null // notifications/initialized, cancelled, …: nothing to say
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    // No server-initiated stream and no sessions to end: POST is the whole protocol here.
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405, { Allow: 'POST, OPTIONS' })

    let key: Key | null
    try {
      key = await keyFor(req)
    } catch (e) {
      console.error('crm-mcp key lookup failure', e)
      return json(rpcError(null, -32603, 'The CRM is unavailable right now.'), 503)
    }
    if (!key) {
      return json(rpcError(null, -32001, 'Missing or unknown access key. Make one in the CRM under Settings → Assistant access.'), 401, {
        'WWW-Authenticate': 'Bearer realm="personal-crm"',
      })
    }

    const raw = await req.text()
    if (raw.length > MAX_BODY) return json(rpcError(null, -32600, 'Request too large'), 413)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json(rpcError(null, -32700, 'Parse error'), 400)
    }

    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((m) => answer(key!, m as Rpc)))).filter(Boolean)
      return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS })
    }
    const reply = await answer(key, body as Rpc)
    return reply ? json(reply) : new Response(null, { status: 202, headers: CORS })
  }
}
