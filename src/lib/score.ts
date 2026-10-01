import {
  CATEGORIES,
  type Category,
  type EvidenceClass,
  type Incident,
  type Model,
  type Provider,
} from '../data/schema'

export type EvidenceFilter = 'all' | 'production' | 'evaluation'

export interface Filters {
  query?: string
  providerIds?: ReadonlySet<string>
  categories?: ReadonlySet<Category>
  evidence?: EvidenceFilter
}

export interface Row {
  kind: 'model' | 'provider'
  id: string
  name: string
  providerId: string
  providerName: string
  score: number
  count: number
  byCategory: Record<Category, number>
  evidence: EvidenceClass[]
  lastIncident: string | null
  incidents: Incident[]
}

export type SortKey = 'rank' | 'name' | 'provider' | 'score' | 'count' | 'last' | Category
export type SortDir = 'asc' | 'desc'

const emptyCategories = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

export function matchesEvidence(inc: Incident, evidence: EvidenceFilter | undefined): boolean {
  if (!evidence || evidence === 'all') return true
  if (evidence === 'production') return inc.evidenceClass !== 'evaluation'
  return inc.evidenceClass === 'evaluation'
}

/** Apply category and evidence filters to the docket. Provider and query filters apply to rows, not incidents. */
export function filterIncidents(incidents: readonly Incident[], f: Filters = {}): Incident[] {
  return incidents.filter((inc) => {
    if (f.categories && f.categories.size > 0 && !f.categories.has(inc.category)) return false
    return matchesEvidence(inc, f.evidence)
  })
}

export function byDateDesc(a: Incident, b: Incident): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)
}

function buildRow(base: Omit<Row, 'score' | 'count' | 'byCategory' | 'evidence' | 'lastIncident' | 'incidents'>, incidents: Incident[]): Row {
  const byCategory = emptyCategories()
  const evidence = new Set<EvidenceClass>()
  let score = 0
  for (const inc of incidents) {
    score += inc.degree
    byCategory[inc.category] += 1
    evidence.add(inc.evidenceClass)
  }
  const sorted = [...incidents].sort(byDateDesc)
  return {
    ...base,
    score,
    count: incidents.length,
    byCategory,
    evidence: [...evidence].sort(),
    lastIncident: sorted[0]?.date ?? null,
    incidents: sorted,
  }
}

export function scoreModels(models: readonly Model[], providers: readonly Provider[], incidents: readonly Incident[]): Row[] {
  const providerName = new Map(providers.map((p) => [p.id, p.name]))
  return models.map((m) =>
    buildRow(
      { kind: 'model', id: m.id, name: m.name, providerId: m.providerId, providerName: providerName.get(m.providerId) ?? m.providerId },
      incidents.filter((inc) => inc.modelIds.includes(m.id)),
    ),
  )
}

/** An incident counts once per provider, regardless of how many of that provider's models it names. */
export function scoreProviders(providers: readonly Provider[], incidents: readonly Incident[]): Row[] {
  return providers.map((p) =>
    buildRow(
      { kind: 'provider', id: p.id, name: p.name, providerId: p.id, providerName: p.name },
      incidents.filter((inc) => inc.providerIds.includes(p.id)),
    ),
  )
}

export function filterRows(rows: readonly Row[], f: Filters & { hideClean?: boolean } = {}): Row[] {
  const q = f.query?.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.hideClean && r.count === 0) return false
    if (f.providerIds && f.providerIds.size > 0 && !f.providerIds.has(r.providerId)) return false
    if (q && !r.name.toLowerCase().includes(q) && !r.providerName.toLowerCase().includes(q)) return false
    return true
  })
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case 'rank':
    case 'score':
      return a.score - b.score
    case 'count':
      return a.count - b.count
    case 'name':
      return a.name.localeCompare(b.name)
    case 'provider':
      return a.providerName.localeCompare(b.providerName)
    case 'last':
      return (a.lastIncident ?? '').localeCompare(b.lastIncident ?? '')
    default:
      return a.byCategory[key] - b.byCategory[key]
  }
}

/** Default order is score desc, then count desc, then name asc. Ties in any other key fall back to the same. */
export function sortRows(rows: readonly Row[], key: SortKey = 'score', dir: SortDir = 'desc'): Row[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const primary = compare(a, b, key) * sign
    if (primary !== 0) return primary
    if (key !== 'score' && b.score !== a.score) return b.score - a.score
    if (b.count !== a.count) return b.count - a.count
    return a.name.localeCompare(b.name)
  })
}

/** Competition ranking: equal scores share a rank, next rank skips. Zero scores are unranked. */
export function assignRanks(rows: readonly Row[]): Map<string, number | null> {
  const ordered = sortRows(rows, 'score', 'desc')
  const ranks = new Map<string, number | null>()
  let rank = 0
  let prev: number | null = null
  ordered.forEach((r, i) => {
    if (r.score === 0) {
      ranks.set(r.id, null)
      return
    }
    if (r.score !== prev) rank = i + 1
    prev = r.score
    ranks.set(r.id, rank)
  })
  return ranks
}

export interface Stats {
  incidents: number
  totalScore: number
  modelsImplicated: number
  providersImplicated: number
  lastIncident: string | null
  leader: Row | null
}

export function computeStats(incidents: readonly Incident[], modelRows: readonly Row[]): Stats {
  const modelIds = new Set<string>()
  const providerIds = new Set<string>()
  let totalScore = 0
  let last: string | null = null
  for (const inc of incidents) {
    totalScore += inc.degree
    inc.modelIds.forEach((m) => modelIds.add(m))
    inc.providerIds.forEach((p) => providerIds.add(p))
    if (!last || inc.date > last) last = inc.date
  }
  const leader = sortRows(modelRows, 'score', 'desc')[0]
  return {
    incidents: incidents.length,
    totalScore,
    modelsImplicated: modelIds.size,
    providersImplicated: providerIds.size,
    lastIncident: last,
    leader: leader && leader.score > 0 ? leader : null,
  }
}
