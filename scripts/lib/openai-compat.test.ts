import { describe, expect, it } from 'vitest'
import { researchOpenAI, type OpenAICompatConfig } from './openai-compat.ts'
import type { WebTools } from './web-tools.ts'

type Reply = { status?: number; body?: unknown }

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })
const toolTurn = (...calls: ReturnType<typeof call>[]): Reply => ({ body: { choices: [{ message: { content: null, tool_calls: calls }, finish_reason: 'tool_calls' }] } })
const textTurn = (content: string, finish = 'stop'): Reply => ({ body: { choices: [{ message: { content }, finish_reason: finish }] } })

function harness(replies: Reply[], tools: Partial<WebTools> = {}) {
  const requests: { url: string; body: { model: string; messages: { role: string; content?: string | null; tool_call_id?: string }[] }; headers: Record<string, string> }[] = []
  const used = { search: [] as string[], fetch: [] as string[] }
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> })
    const r = replies.shift()
    if (!r) throw new Error('no more replies')
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }) as typeof fetch
  const cfg: OpenAICompatConfig = {
    label: 'test',
    baseUrl: 'http://gw.test/v1/',
    model: 'm',
    apiKey: 'sk',
    fetchImpl,
    backoffMs: () => 0,
    tools: {
      search: tools.search ?? (async (q) => (used.search.push(q), [{ title: 'Hit', url: 'https://src.test/a', snippet: 's' }])),
      fetch: tools.fetch ?? (async (u) => (used.fetch.push(u), 'page text')),
    },
  }
  const logs: string[] = []
  const run = (maxSearches = 10) => researchOpenAI(cfg, 'SYS', 'PROMPT', { maxSearches, log: (s) => logs.push(s) })
  return { run, requests, used, logs }
}

const payload = { incidents: [{ title: 'x' }], candidateModels: [] }

describe('researchOpenAI', () => {
  it('runs search and fetch, then returns the submission', async () => {
    const h = harness([
      toolTurn(call('1', 'web_search', { query: 'llm incident' })),
      toolTurn(call('2', 'web_fetch', { url: 'https://src.test/a' })),
      toolTurn(call('3', 'submit_incidents', payload)),
    ])
    expect(await h.run()).toEqual(payload)
    expect(h.used).toEqual({ search: ['llm incident'], fetch: ['https://src.test/a'] })
    expect(h.requests[0].url).toBe('http://gw.test/v1/chat/completions')
    expect(h.requests[0].headers.authorization).toBe('Bearer sk')
    expect(h.requests[0].body.messages[0].content).toMatch(/^SYS[\s\S]*web_fetch/)
    const toolMsg = h.requests[1].body.messages.at(-1)!
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: '1' })
    expect(toolMsg.content).toMatch(/Hit\n\s+https:\/\/src\.test\/a/)
  })

  it('reports bad tool-call JSON and keeps going', async () => {
    const h = harness([toolTurn(call('1', 'web_search', '{oops')), toolTurn(call('2', 'submit_incidents', payload))])
    expect(await h.run()).toEqual(payload)
    expect(h.requests[1].body.messages.at(-1)!.content).toMatch(/not valid JSON/)
  })

  it('stops running tools past the search budget', async () => {
    const h = harness([
      toolTurn(call('1', 'web_search', { query: 'a' }), call('2', 'web_search', { query: 'b' })),
      toolTurn(call('3', 'submit_incidents', { incidents: 'nope' })),
    ])
    expect(await h.run(1)).toEqual({ incidents: [], candidateModels: [] })
    expect(h.used.search).toEqual(['a'])
    expect(h.requests[1].body.messages.at(-1)!.content).toMatch(/budget exhausted/)
  })

  it('nudges once on a plain reply, then gives up', async () => {
    const h = harness([textTurn('Here is my report'), textTurn('Still a report')])
    expect(await h.run()).toBeNull()
    expect(h.requests[1].body.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringMatching(/must call submit_incidents/) })
  })

  it('asks for a submission when output is truncated', async () => {
    const h = harness([textTurn('…', 'length'), toolTurn(call('1', 'submit_incidents', payload))])
    expect(await h.run()).toEqual(payload)
    expect(h.requests[1].body.messages.at(-1)!.content).toMatch(/Stop researching/)
  })

  it('retries 5xx and 429, but not 4xx', async () => {
    const ok = harness([{ status: 503, body: {} }, { status: 429, body: {} }, toolTurn(call('1', 'submit_incidents', payload))])
    expect(await ok.run()).toEqual(payload)
    expect(ok.requests).toHaveLength(3)

    const bad = harness([{ status: 401, body: { error: 'no' } }])
    await expect(bad.run()).rejects.toThrow(/401/)
    expect(bad.requests).toHaveLength(1)
  })

  it('gives up after three failed attempts', async () => {
    const h = harness([{ status: 500 }, { status: 500 }, { status: 500 }])
    await expect(h.run()).rejects.toThrow(/after 3 attempts/)
  })
})
