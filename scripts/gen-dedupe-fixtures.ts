/**
 * Regenerates shared/fixtures/dedupe-cases.json from the TypeScript dedupe implementation. The Rust port
 * (api/src/dedupe.rs) and scripts/lib/dedupe.test.ts both assert against the file, which keeps them in step.
 *
 *   pnpm tsx scripts/gen-dedupe-fixtures.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Incident, IncidentBody } from '../src/data/schema.ts'
import { findDuplicate, normalizeUrl, titleSimilarity } from './lib/dedupe.ts'

const urls = [
  'https://www.example.com/a/b/',
  'http://www.example.com/a',
  'http://example.com/a',
  'https://Example.COM:8443/Path//?utm_source=x&id=7&fbclid=abc#frag',
  'https://news.site/story?ref=hn&source=rss&page=2',
  'https://news.site/story?Ref=x&refresh=1',
  'https://a.example/q?x=a b&y=%C3%A9',
  'https://a.example/',
  'not a url ',
]

const titles: [string, string][] = [
  ['Claude deletes production database', 'Claude deleted the production database'],
  ['The Model and the Court', 'model court'],
  ['Café résumé fabricated', 'Cafe resume fabricated'],
  ['GPT-4o leaks keys', 'gpt 4o leaks keys!'],
  ['of the and', 'a an the'],
  ['Replit agent wipes SaaStr database during code freeze', 'Replit AI agent deletes SaaStr production database during code freeze'],
]

const body = (over: Partial<IncidentBody>): IncidentBody => ({
  date: '2026-03-01',
  title: 'Acme agent wipes customer backups',
  summary: 'Acme said so.',
  modelIds: [],
  providerIds: ['acme'],
  category: 'destruction',
  degree: 2,
  evidenceClass: 'production',
  role: 'actor',
  attributionConfidence: 'confirmed',
  sources: [{ title: 'Report', url: 'https://news.example/acme', publisher: 'News', date: '2026-03-01' }],
  ...over,
})
const existing: Incident[] = [
  { id: 'old-acme', ...body({}) },
  { id: 'old-globex', ...body({ providerIds: ['globex'], title: 'Globex model fabricates citations', date: '2026-02-01', sources: [{ title: 'Order', url: 'https://www.court.example/order/', publisher: 'Court', date: '2026-02-01' }] }) },
]
const src = (url: string) => [{ title: 'S', url, publisher: 'P', date: '2026-03-01' }]
const dupeCases = [
  { name: 'same source after normalization', candidate: body({ title: 'Totally different', providerIds: ['initech'], sources: src('https://court.example/order/?utm_campaign=x#top') }) },
  { name: 'similar title, same provider, within 30 days', candidate: body({ date: '2026-03-20', title: 'Acme agent wipes the customer backups', sources: src('https://other.example/1') }) },
  { name: 'similar title, different provider', candidate: body({ providerIds: ['globex'], date: '2026-03-02', title: 'Acme agent wipes customer backups', sources: src('https://other.example/2') }) },
  { name: 'similar title, outside 30 days', candidate: body({ date: '2026-04-15', sources: src('https://other.example/3') }) },
  { name: 'http is not https', candidate: body({ title: 'Unrelated', providerIds: ['initech'], sources: src('http://court.example/order') }) },
  { name: 'distinct', candidate: body({ title: 'Acme chatbot leaks support tickets', sources: src('https://other.example/4') }) },
]

const fixtures = {
  normalizeUrl: urls.map((u) => [u, normalizeUrl(u)]),
  titleSimilarity: titles.map(([a, b]) => [a, b, titleSimilarity(a, b)]),
  findDuplicate: dupeCases.map((c) => ({ ...c, existing, expect: findDuplicate(c.candidate, existing) })),
}
writeFileSync(resolve(import.meta.dirname, '../shared/fixtures/dedupe-cases.json'), `${JSON.stringify(fixtures, null, 2)}\n`)
console.log('wrote shared/fixtures/dedupe-cases.json')
