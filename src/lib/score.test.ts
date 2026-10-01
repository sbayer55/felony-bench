import { describe, expect, it } from 'vitest'
import type { Incident, Model, Provider } from '../data/schema'
import { assignRanks, computeStats, filterIncidents, filterRows, scoreModels, scoreProviders, sortRows } from './score'

const providers: Provider[] = [
  { id: 'acme', name: 'Acme', url: 'https://acme.test' },
  { id: 'globex', name: 'Globex', url: 'https://globex.test' },
  { id: 'initech', name: 'Initech', url: 'https://initech.test' },
]
const models: Model[] = [
  { id: 'acme-1', name: 'Acme 1', providerId: 'acme' },
  { id: 'acme-2', name: 'Acme 2', providerId: 'acme' },
  { id: 'globex-x', name: 'Globex X', providerId: 'globex' },
  { id: 'initech-z', name: 'Initech Z', providerId: 'initech' },
]
const src = { title: 't', url: 'https://example.test/a', publisher: 'p', date: '2025-01-01' }
const incidents: Incident[] = [
  {
    id: 'a', date: '2025-01-10', title: 'A', summary: 's', modelIds: ['acme-1', 'acme-2'], providerIds: ['acme'],
    category: 'deception', degree: 2, evidenceClass: 'evaluation', role: 'actor', attributionConfidence: 'confirmed', sources: [src],
  },
  {
    id: 'b', date: '2025-03-01', title: 'B', summary: 's', modelIds: ['globex-x'], providerIds: ['globex'],
    category: 'destruction', degree: 3, evidenceClass: 'production', role: 'actor', attributionConfidence: 'confirmed', sources: [src],
  },
  {
    id: 'c', date: '2025-02-01', title: 'C', summary: 's', modelIds: ['acme-1'], providerIds: ['acme'],
    category: 'extortion', degree: 1, evidenceClass: 'production', role: 'instrument', attributionConfidence: 'reported', sources: [src],
  },
]

describe('scoring', () => {
  it('sums degrees per model and tracks categories and last incident', () => {
    const rows = scoreModels(models, providers, incidents)
    const acme1 = rows.find((r) => r.id === 'acme-1')!
    expect(acme1.score).toBe(3)
    expect(acme1.count).toBe(2)
    expect(acme1.byCategory.deception).toBe(1)
    expect(acme1.byCategory.extortion).toBe(1)
    expect(acme1.lastIncident).toBe('2025-02-01')
    expect(acme1.evidence).toEqual(['evaluation', 'production'])
    expect(acme1.incidents.map((i) => i.id)).toEqual(['c', 'a'])
  })

  it('counts a multi-model incident once per provider', () => {
    const rows = scoreProviders(providers, incidents)
    const acme = rows.find((r) => r.id === 'acme')!
    expect(acme.count).toBe(2)
    expect(acme.score).toBe(3)
    expect(rows.find((r) => r.id === 'initech')!.score).toBe(0)
  })

  it('sorts by score desc with count then name tie-breaks', () => {
    const rows = sortRows(scoreModels(models, providers, incidents))
    expect(rows.map((r) => r.id)).toEqual(['acme-1', 'globex-x', 'acme-2', 'initech-z'])
  })

  it('sorts ascending by name when asked', () => {
    const rows = sortRows(scoreModels(models, providers, incidents), 'name', 'asc')
    expect(rows[0].id).toBe('acme-1')
    expect(rows.at(-1)!.id).toBe('initech-z')
  })

  it('uses competition ranking and leaves clean records unranked', () => {
    const ranks = assignRanks(scoreModels(models, providers, incidents))
    expect(ranks.get('acme-1')).toBe(1)
    expect(ranks.get('globex-x')).toBe(1)
    expect(ranks.get('acme-2')).toBe(3)
    expect(ranks.get('initech-z')).toBeNull()
  })

  it('filters incidents by evidence class and category', () => {
    expect(filterIncidents(incidents, { evidence: 'production' }).map((i) => i.id)).toEqual(['b', 'c'])
    expect(filterIncidents(incidents, { evidence: 'evaluation' }).map((i) => i.id)).toEqual(['a'])
    expect(filterIncidents(incidents, { categories: new Set(['extortion']) }).map((i) => i.id)).toEqual(['c'])
  })

  it('filters rows by provider, query, and clean records', () => {
    const rows = scoreModels(models, providers, incidents)
    expect(filterRows(rows, { providerIds: new Set(['globex']) }).map((r) => r.id)).toEqual(['globex-x'])
    expect(filterRows(rows, { query: 'INIT' }).map((r) => r.id)).toEqual(['initech-z'])
    expect(filterRows(rows, { hideClean: true }).map((r) => r.id).sort()).toEqual(['acme-1', 'acme-2', 'globex-x'])
  })

  it('computes headline stats', () => {
    const rows = scoreModels(models, providers, incidents)
    const s = computeStats(incidents, rows)
    expect(s.incidents).toBe(3)
    expect(s.totalScore).toBe(6)
    expect(s.modelsImplicated).toBe(3)
    expect(s.providersImplicated).toBe(2)
    expect(s.lastIncident).toBe('2025-03-01')
    expect(s.leader?.id).toBe('acme-1')
    expect(computeStats([], scoreModels(models, providers, [])).leader).toBeNull()
  })
})
