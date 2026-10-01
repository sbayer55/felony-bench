/**
 * Research loop for OpenAI-compatible chat completions endpoints (Ollama, Bifrost, 9router). These have no
 * server-side search, so web_search / web_fetch run here as client-side tools.
 */
import { SUBMIT_TOOL_DESCRIPTION, SUBMIT_TOOL_NAME, normalizePayload, submitIncidentsSchema, type ResearchOptions, type ResearchProvider, type SubmitPayload } from './research.ts'
import { formatHits, type WebTools } from './web-tools.ts'

const MAX_TURNS = 60

export const CLIENT_TOOLS_NOTE = `\n\nTOOLS\nUse web_search to find candidates, then web_fetch every source you intend to cite to confirm it supports your summary. Only cite URLs you fetched successfully.`

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface OpenAICompatConfig {
  label: string
  baseUrl: string
  model: string
  apiKey?: string
  tools: WebTools
  fetchImpl?: typeof fetch
  /** Delay before retry n (1-based). Injected so tests don't sleep. */
  backoffMs?: (attempt: number) => number
}

const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Returns up to 10 results with title, URL and snippet.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and return its readable text (truncated). Use it to confirm a source before citing it.',
      parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
    },
  },
  { type: 'function', function: { name: SUBMIT_TOOL_NAME, description: SUBMIT_TOOL_DESCRIPTION, parameters: submitIncidentsSchema } },
]

export function openAICompatProvider(cfg: OpenAICompatConfig): ResearchProvider {
  return { label: cfg.label, research: (system, prompt, opts) => researchOpenAI(cfg, system, prompt, opts) }
}

async function complete(cfg: OpenAICompatConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const fetchImpl = cfg.fetchImpl ?? fetch
  const backoff = cfg.backoffMs ?? ((n) => 2000 * 2 ** (n - 1))
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const body = JSON.stringify({ model: cfg.model, messages, tools: toolDefs, tool_choice: 'auto' })

  for (let attempt = 1; ; attempt++) {
    let retryable = ''
    let res: Response | undefined
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(600_000) })
    } catch (e) {
      retryable = (e as Error).message
    }
    if (res) {
      if (res.ok) return (await res.json()) as ChatResponse
      const text = (await res.text()).slice(0, 500)
      if (res.status !== 429 && res.status < 500) throw new Error(`${url} -> ${res.status}: ${text}`)
      retryable = `${res.status}: ${text}`
    }
    if (attempt >= 3) throw new Error(`${url} failed after ${attempt} attempts: ${retryable}`)
    await new Promise((r) => setTimeout(r, backoff(attempt)))
  }
}

export async function researchOpenAI(cfg: OpenAICompatConfig, system: string, prompt: string, opts: ResearchOptions): Promise<SubmitPayload | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: system + CLIENT_TOOLS_NOTE },
    { role: 'user', content: prompt },
  ]
  let toolUses = 0
  let nudged = false

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await complete(cfg, messages)
    const choice = response.choices?.[0]
    const msg = choice?.message ?? {}
    const calls = msg.tool_calls ?? []
    opts.log(`turn ${turn + 1}: finish=${choice?.finish_reason ?? '?'} tool_calls=${calls.map((c) => c.function.name).join(',') || '-'} in=${response.usage?.prompt_tokens ?? '?'} out=${response.usage?.completion_tokens ?? '?'}`)

    messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) })

    if (calls.length) {
      for (const call of calls) {
        let args: Record<string, unknown>
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        } catch {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: arguments were not valid JSON. Retry with valid JSON.' })
          continue
        }
        if (call.function.name === SUBMIT_TOOL_NAME) return normalizePayload(args)
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(cfg.tools, call.function.name, args, ++toolUses > opts.maxSearches, opts.log) })
      }
      continue
    }

    if (choice?.finish_reason === 'length') {
      opts.log('hit max tokens before submitting; asking the model to submit now')
      messages.push({ role: 'user', content: `Stop researching and call ${SUBMIT_TOOL_NAME} now with what you have verified.` })
      continue
    }

    // Plain reply without a submission: nudge once, then give up.
    if (!nudged) {
      nudged = true
      messages.push({ role: 'user', content: `You must call ${SUBMIT_TOOL_NAME} to finish, even with an empty list.` })
      continue
    }
    return null
  }
  return null
}

async function runTool(tools: WebTools, name: string, args: Record<string, unknown>, overBudget: boolean, log: (s: string) => void): Promise<string> {
  if (name !== 'web_search' && name !== 'web_fetch') return `Error: unknown tool ${name}.`
  if (overBudget) {
    log(`  ${name} refused: search budget exhausted`)
    return `Search budget exhausted. Call ${SUBMIT_TOOL_NAME} now with what you have verified.`
  }
  try {
    if (name === 'web_search') {
      const query = String(args.query ?? '')
      log(`  web_search ${JSON.stringify(query)}`)
      return formatHits(await tools.search(query))
    }
    const url = String(args.url ?? '')
    log(`  web_fetch ${url}`)
    return await tools.fetch(url)
  } catch (e) {
    return `Error: ${(e as Error).message}`
  }
}
