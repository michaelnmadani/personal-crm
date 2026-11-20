import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useApiTokens, useAssistantLog, useMut } from '../lib/hooks'
import { ago, fmtDateTime } from '../lib/utils'
import { Icon } from './Icon'
import { btnGhost, btnPrimary, card, input } from './ui'

/** Where assistants connect: the crm-mcp edge function on this app's Supabase project. */
const CONNECTOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-mcp`

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="text-xs text-indigo-400 hover:underline shrink-0"
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true)
            window.setTimeout(() => setDone(false), 2000)
          })
          .catch(() => undefined)
      }
    >
      {done ? 'Copied' : label}
    </button>
  )
}

/**
 * Settings → Assistant access. Keys let an assistant such as Meta's Muse add
 * and update people, connections, meetings and notes; the log underneath shows
 * everything one has done, so a wrong guess is easy to find and put right.
 */
export function AssistantAccess() {
  const { data: tokens } = useApiTokens()
  const { data: log } = useAssistantLog()
  const [label, setLabel] = useState('Muse')
  const [fresh, setFresh] = useState<string | null>(null)
  const create = useMut((l: string) => api.createApiToken(l))
  const revoke = useMut(api.revokeApiToken)

  const active = (tokens ?? []).filter((t) => !t.revoked_at)
  const setupText = fresh
    ? `Create a custom connector called "Personal CRM" for my MCP server at ${CONNECTOR_URL}. ` +
      `It uses a bearer token in the Authorization header: ${fresh}`
    : ''

  return (
    <section className={`${card} p-4 space-y-4`}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-300">Assistant access</h2>
        <p className="text-sm text-slate-400">
          Let an assistant such as Meta’s Muse add and update people, the connections between them, meetings and notes —
          by voice or chat. It can look people up to find who you mean, but it can’t delete anything, and everything it
          does is listed below.
        </p>
      </div>

      {fresh ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
          <p className="text-sm text-emerald-300 font-medium">Key created — copy it now. It won’t be shown again.</p>
          <div className="flex items-start gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200">{fresh}</code>
            <CopyButton text={fresh} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">
              To connect Muse, open a chat in Muse and send it this — it sets up the connector itself:
            </p>
            <div className="flex items-start gap-2">
              <p className="flex-1 min-w-0 break-words rounded bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300">{setupText}</p>
              <CopyButton text={setupText} />
            </div>
            <p className="text-xs text-slate-500">
              Then try “Find Sarah in my CRM”. Other assistants (Claude, ChatGPT) take the same address and key as a
              custom MCP connector.
            </p>
          </div>
          <button className={btnGhost} onClick={() => setFresh(null)}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(label, { onSuccess: ({ key }) => setFresh(key) })
          }}
        >
          <label className="flex-1 min-w-40">
            <span className="block text-xs text-slate-500 mb-1">Name for the key</span>
            <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </label>
          <button type="submit" className={btnPrimary} disabled={create.isPending || !label.trim()}>
            <Icon name="plus" className="w-4 h-4" /> {create.isPending ? 'Creating…' : 'Create access key'}
          </button>
        </form>
      )}
      {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}

      {active.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Keys in use</h3>
          <ul className="divide-y divide-slate-800">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200">{t.label}</p>
                  <p className="text-xs text-slate-500">
                    Made {fmtDateTime(t.created_at)} · {t.last_used_at ? `last used ${ago(t.last_used_at)}` : 'not used yet'}
                  </p>
                </div>
                <button
                  className="text-xs text-red-400 hover:underline"
                  onClick={() => {
                    if (window.confirm(`Revoke “${t.label}”? Anything using this key stops working straight away.`)) revoke.mutate(t.id)
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
          {revoke.isError && <p className="text-sm text-red-400">{(revoke.error as Error).message}</p>}
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Recent assistant activity</h3>
        {(log ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {(log ?? []).map((e) => (
              <li key={e.id} className="text-sm">
                <span className={e.ok ? 'text-slate-300' : 'text-amber-400'}>
                  {e.ok ? '' : 'Didn’t work: '}
                  {e.summary}
                </span>{' '}
                <span className="text-xs text-slate-500">
                  {ago(e.created_at)}
                  {e.contact_ids.length === 1 && (
                    <>
                      {' · '}
                      <Link to={`/contacts/${e.contact_ids[0]}`} className="text-indigo-400 hover:underline">
                        open
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
