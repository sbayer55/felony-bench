/**
 * Client-side web_search / web_fetch for providers that have no server-side search (Ollama, Bifrost, 9router).
 */

export const USER_AGENT = 'felony-bench-refresh/1.0 (+https://github.com/sbayer55/felony-bench)'

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

export type SearchBackendName = 'brave' | 'searxng' | 'ollama'

export interface SearchConfig {
  backend: SearchBackendName
  apiKey?: string
  /** SearXNG instance URL. */
  url?: string
}

export interface WebTools {
  search(query: string): Promise<SearchHit[]>
  fetch(url: string): Promise<string>
}

const MAX_HITS = 10
const MAX_PAGE_CHARS = 20_000

type FetchFn = typeof fetch

async function getJson(fetchImpl: FetchFn, url: string, init: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`search ${res.status} ${res.statusText}`)
  return res.json()
}

export function makeSearch(cfg: SearchConfig, fetchImpl: FetchFn = fetch): (query: string) => Promise<SearchHit[]> {
  switch (cfg.backend) {
    case 'brave':
      return async (q) => {
        const data = (await getJson(fetchImpl, `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${MAX_HITS}`, {
          headers: { accept: 'application/json', 'x-subscription-token': cfg.apiKey ?? '' },
        })) as { web?: { results?: { title?: string; url?: string; description?: string }[] } }
        return (data.web?.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: htmlToText(r.description ?? '') }))
      }
    case 'searxng':
      return async (q) => {
        const base = (cfg.url ?? '').replace(/\/+$/, '')
        const data = (await getJson(fetchImpl, `${base}/search?format=json&q=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' } })) as {
          results?: { title?: string; url?: string; content?: string }[]
        }
        return (data.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }))
      }
    case 'ollama':
      return async (q) => {
        const data = (await getJson(fetchImpl, 'https://ollama.com/api/web_search', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey ?? ''}` },
          body: JSON.stringify({ query: q, max_results: MAX_HITS }),
        })) as { results?: { title?: string; url?: string; content?: string }[] }
        return (data.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: (r.content ?? '').slice(0, 500) }))
      }
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function htmlToText(html: string, max = MAX_PAGE_CHARS): string {
  const text = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text
}

/** The model picks these URLs, so keep the runner from being pointed at internal hosts. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')) return false
  }
  return true
}

export function makeFetch(fetchImpl: FetchFn = fetch): (url: string) => Promise<string> {
  return async (url) => {
    if (!isPublicHttpUrl(url)) return `Refused: ${url} is not a public http(s) URL.`
    const res = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) })
    const type = res.headers.get('content-type') ?? ''
    const head = `URL: ${res.url || url}\nStatus: ${res.status}\n`
    if (!res.ok) return `${head}Fetch failed.`
    if (/html|xml/i.test(type)) return head + htmlToText(await res.text())
    if (/^text\/|json/i.test(type)) return head + (await res.text()).slice(0, MAX_PAGE_CHARS)
    return `${head}Unsupported content-type ${type || 'unknown'}; cannot read this document. Find an HTML source instead.`
  }
}

export function makeWebTools(cfg: SearchConfig, fetchImpl: FetchFn = fetch): WebTools {
  return { search: makeSearch(cfg, fetchImpl), fetch: makeFetch(fetchImpl) }
}

export function formatHits(hits: SearchHit[]): string {
  if (!hits.length) return 'No results.'
  return hits
    .slice(0, MAX_HITS)
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
}
