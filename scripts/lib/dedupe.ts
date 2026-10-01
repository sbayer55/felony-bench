import type { Incident, IncidentBody } from '../../src/data/schema.ts'

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'for', 'by', 'with', 'at', 'from', 'its', 'as', 'is', 'was', 'after', 'over'])

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u)
    url.hash = ''
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(k)) url.searchParams.delete(k)
    }
    let s = `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
    const q = url.searchParams.toString()
    if (q) s += `?${q}`
    return s.replace(/^https?:\/\/www\./, 'https://')
  } catch {
    return u.trim().toLowerCase()
  }
}

export function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !STOP.has(t)),
  )
}

/** Jaccard similarity on content tokens, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000)
}

export interface DupeMatch {
  existingId: string
  reason: 'source-url' | 'similar-title'
}

export function findDuplicate(candidate: IncidentBody, existing: readonly Incident[], threshold = 0.8): DupeMatch | null {
  const candUrls = new Set(candidate.sources.map((s) => normalizeUrl(s.url)))
  for (const inc of existing) {
    if (inc.sources.some((s) => candUrls.has(normalizeUrl(s.url)))) return { existingId: inc.id, reason: 'source-url' }
  }
  for (const inc of existing) {
    const sharesProvider = inc.providerIds.some((p) => candidate.providerIds.includes(p))
    if (!sharesProvider) continue
    if (daysBetween(inc.date, candidate.date) > 30) continue
    if (titleSimilarity(inc.title, candidate.title) >= threshold) return { existingId: inc.id, reason: 'similar-title' }
  }
  return null
}
