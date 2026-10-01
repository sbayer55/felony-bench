import { describe, expect, it } from 'vitest'
import type { Incident, Model, Provider } from '../../src/data/schema.ts'
import { findDuplicate, normalizeUrl, titleSimilarity } from './dedupe.ts'
import { makeId, runPipeline } from './pipeline.ts'

const providers: Provider[] = [
  { id: 'acme', name: 'Acme', url: 'https://acme.test' },
  { id: 'globex', name: 'Globex', url: 'https://globex.test' },
]
const models: Model[] = [{ id: 'acme-1', name: 'Acme 1', providerId: 'acme' }]
const existing: Incident[] = [
  {
    id: '2025-05-01-acme-1-blackmails-engineer', date: '2025-05-01', title: 'Acme 1 blackmails engineer in replacement scenario', summary: 's',
    modelIds: ['acme-1'], providerIds: ['acme'], category: 'extortion', degree: 2, evidenceClass: 'evaluation', role: 'actor',
    attributionConfidence: 'confirmed', sources: [{ title: 't', url: 'https://acme.test/card.pdf', publisher: 'Acme', date: '2025-05-01' }],
  },
]
const good = {
  date: '2025-06-10', title: 'Globex model deletes production database', summary: 'According to Globex, it did.',
  modelIds: [], providerIds: ['globex'], category: 'destruction', degree: 2, evidenceClass: 'production', role: 'actor',
  attributionConfidence: 'confirmed', sources: [{ title: 'Post', url: 'https://globex.test/post', publisher: 'Globex', date: '2025-06-10' }], tags: [],
}
const ok = async () => true

describe('dedupe', () => {
  it('normalizes urls', () => {
    expect(normalizeUrl('https://www.Example.com/a/b/?utm_source=x')).toBe('https://example.com/a/b')
    expect(normalizeUrl('https://example.com/a#frag')).toBe('https://example.com/a')
  })
  it('scores title similarity', () => {
    expect(titleSimilarity('Acme 1 blackmails engineer in replacement scenario', 'Acme 1 blackmails an engineer in a replacement scenario')).toBeGreaterThan(0.8)
    expect(titleSimilarity('Acme 1 blackmails engineer', 'Globex leaks database')).toBeLessThan(0.2)
  })
  it('flags duplicates by url and by similar title near in time with shared provider', () => {
    expect(findDuplicate({ ...good, providerIds: ['acme'], sources: [{ ...good.sources[0], url: 'https://www.acme.test/card.pdf?utm_source=t' }] } as never, existing)?.reason).toBe('source-url')
    expect(findDuplicate({ ...good, providerIds: ['acme'], date: '2025-05-20', title: 'Acme 1 blackmails an engineer in a replacement scenario' } as never, existing)?.reason).toBe('similar-title')
    expect(findDuplicate({ ...good, providerIds: ['acme'], date: '2025-09-20', title: 'Acme 1 blackmails an engineer in a replacement scenario' } as never, existing)).toBeNull()
    expect(findDuplicate(good as never, existing)).toBeNull()
  })
})

describe('pipeline', () => {
  it('accepts a valid candidate and assigns an id', async () => {
    const r = await runPipeline({ candidates: [good], candidateModels: [], providers, models, existing, max: 10, sourcesReachable: ok })
    expect(r.rejected).toEqual([])
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0].id).toBe('2025-06-10-globex-model-deletes-production-database')
  })
  it('rejects schema failures, unknown providers, future dates, and unreachable sources', async () => {
    const r = await runPipeline({
      candidates: [
        { ...good, degree: 5 },
        { ...good, providerIds: ['nope'] },
        { ...good, date: '2999-01-01' },
        { ...good, sources: [{ ...good.sources[0], url: 'http://insecure.test/x' }] },
      ],
      candidateModels: [], providers, models, existing, max: 10, sourcesReachable: ok,
    })
    expect(r.accepted).toEqual([])
    expect(r.rejected.map((x) => x.reason.split(':')[0])).toEqual(['schema', 'unknown provider(s)', 'dated in the future (2999-01-01)', 'schema'])
    const r2 = await runPipeline({ candidates: [good], candidateModels: [], providers, models, existing, max: 10, sourcesReachable: async () => false })
    expect(r2.rejected[0].reason).toMatch(/did not resolve/)
  })
  it('drops unknown models but keeps the incident, and adds candidate models that are referenced', async () => {
    const cand = { ...good, modelIds: ['globex-x', 'ghost'] }
    const r = await runPipeline({ candidates: [cand], candidateModels: [{ id: 'globex-x', name: 'Globex X', providerId: 'globex' }, { id: 'unused', name: 'U', providerId: 'globex' }], providers, models, existing, max: 10, sourcesReachable: ok })
    expect(r.accepted[0].modelIds).toEqual(['globex-x'])
    expect(r.newModels.map((m) => m.id)).toEqual(['globex-x'])
  })
  it('adds the model provider to providerIds automatically', async () => {
    const cand = { ...good, modelIds: ['acme-1'], providerIds: ['globex'] }
    const r = await runPipeline({ candidates: [cand], candidateModels: [], providers, models, existing, max: 10, sourcesReachable: ok })
    expect(r.accepted[0].providerIds.sort()).toEqual(['acme', 'globex'])
  })
  it('dedupes against existing and within the batch, and enforces the cap and --since', async () => {
    const dupe = { ...good, providerIds: ['acme'], sources: [{ ...good.sources[0], url: 'https://acme.test/card.pdf' }] }
    const r = await runPipeline({ candidates: [dupe, good, { ...good, title: 'Globex model deletes a production database' }, { ...good, title: 'Unrelated', date: '2024-01-01' }], candidateModels: [], providers, models, existing, max: 1, since: '2025-01-01', sourcesReachable: ok })
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/duplicate of 2025-05-01/),
      'over cap of 1 per run',
      'over cap of 1 per run',
    ])
  })
  it('makeId avoids collisions', () => {
    const taken = new Set(['2025-06-10-globex-model-deletes-production-database'])
    expect(makeId(good as never, taken)).toBe('2025-06-10-globex-model-deletes-production-database-2')
  })
})
