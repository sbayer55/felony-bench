import { describe, expect, it } from 'vitest'
import { htmlToText, isPublicHttpUrl, makeFetch, makeSearch } from './web-tools.ts'

describe('htmlToText', () => {
  it('strips scripts, styles and tags and decodes entities', () => {
    const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>A &amp; B&#39;s &nbsp;page</p></body></html>'
    expect(htmlToText(html)).toBe("Title\nA & B's page")
  })
  it('truncates', () => {
    expect(htmlToText('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}\n[truncated]`)
  })
})

describe('isPublicHttpUrl', () => {
  it('allows public http(s)', () => {
    expect(isPublicHttpUrl('https://example.com/a')).toBe(true)
    expect(isPublicHttpUrl('http://8.8.8.8/')).toBe(true)
  })
  it('refuses private, local and non-http targets', () => {
    for (const u of ['http://localhost:11434', 'http://127.0.0.1', 'http://10.0.0.1', 'http://192.168.1.1', 'http://172.20.0.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd', 'not a url']) {
      expect(isPublicHttpUrl(u), u).toBe(false)
    }
  })
})

describe('makeFetch', () => {
  it('refuses private hosts without fetching', async () => {
    let called = false
    const f = makeFetch((async () => {
      called = true
      return new Response('')
    }) as typeof fetch)
    expect(await f('http://127.0.0.1/')).toMatch(/Refused/)
    expect(called).toBe(false)
  })
  it('returns readable text for html', async () => {
    const f = makeFetch((async () => new Response('<p>Hello</p>', { headers: { 'content-type': 'text/html' } })) as typeof fetch)
    expect(await f('https://example.com/')).toMatch(/Status: 200\nHello$/)
  })
  it('declines binary content', async () => {
    const f = makeFetch((async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } })) as typeof fetch)
    expect(await f('https://example.com/a.pdf')).toMatch(/Unsupported content-type application\/pdf/)
  })
})

describe('makeSearch', () => {
  it('maps brave results', async () => {
    let seen: RequestInit | undefined
    const s = makeSearch({ backend: 'brave', apiKey: 'b' }, (async (_u: string, init?: RequestInit) => {
      seen = init
      return Response.json({ web: { results: [{ title: 'T', url: 'https://x.test', description: '<strong>snip</strong>' }] } })
    }) as typeof fetch)
    expect(await s('q')).toEqual([{ title: 'T', url: 'https://x.test', snippet: 'snip' }])
    expect((seen!.headers as Record<string, string>)['x-subscription-token']).toBe('b')
  })
})
