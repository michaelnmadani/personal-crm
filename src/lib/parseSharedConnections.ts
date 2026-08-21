import { z } from 'zod'

/**
 * Turns a paste of LinkedIn's "shared connections" panel into candidate people,
 * using a small local model over Ollama — never a server call, since a deployed
 * server has no way to reach the user's own `localhost:11434`. The result is
 * always a proposal: the caller stages it for review, nothing here writes
 * anywhere permanent.
 */

export class OllamaUnavailableError extends Error {
  constructor() {
    super('Could not reach Ollama on localhost:11434')
  }
}

/** The model responded, but not with something that looks like the expected shape. */
export class OllamaParseError extends Error {
  raw: string
  constructor(raw: string) {
    super("Could not parse the model's response")
    this.raw = raw
  }
}

const OLLAMA_URL = 'http://localhost:11434/api/chat'
const MODEL = 'llama3.1:8b-instruct'

const SYSTEM_PROMPT = `You extract people from text copied out of a LinkedIn "shared
connections" panel. The text is messy: names often repeat on
consecutive lines, connection-degree markers (1st/2nd/3rd) and
button labels (Connect, Message, Follow) may appear, and a
leading line like "N mutual connections" is not a person.
Return ONLY a JSON array, no prose, no markdown fences. Each
element: {"name": string, "headline": string or null}.
Deduplicate repeated names. Drop anything that is UI chrome,
not a person.`

const CandidateSchema = z.object({
  name: z.string().min(1),
  headline: z.string().nullable(),
})
const ResponseSchema = z.array(CandidateSchema)

export type ParsedConnection = z.infer<typeof CandidateSchema>

export async function parseSharedConnections(raw: string): Promise<ParsedConnection[]> {
  let res: Response
  try {
    res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        format: 'json',
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: raw },
        ],
      }),
    })
  } catch {
    throw new OllamaUnavailableError()
  }
  if (!res.ok) throw new OllamaUnavailableError()

  const body: unknown = await res.json()
  const content =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message?: { content?: unknown } }).message?.content
      : undefined
  if (typeof content !== 'string') throw new OllamaParseError(JSON.stringify(body))

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new OllamaParseError(content)
  }

  const result = ResponseSchema.safeParse(json)
  if (!result.success) throw new OllamaParseError(content)

  const seen = new Set<string>()
  return result.data.filter((c) => {
    const key = c.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
