import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Incident, IncidentBody } from '../../src/data/schema.ts'
import { findDuplicate, normalizeUrl, titleSimilarity } from './dedupe.ts'

// Shared with api/src/dedupe.rs so both implementations agree. Regenerate with scripts/gen-dedupe-fixtures.ts.
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../shared/fixtures/dedupe-cases.json'), 'utf8')) as {
  normalizeUrl: [string, string][]
  titleSimilarity: [string, string, number][]
  findDuplicate: { name: string; candidate: IncidentBody; existing: Incident[]; expect: unknown }[]
}

describe('dedupe parity fixtures', () => {
  it.each(fixtures.normalizeUrl)('normalizeUrl(%s)', (input, want) => expect(normalizeUrl(input)).toBe(want))
  it.each(fixtures.titleSimilarity)('titleSimilarity(%s, %s)', (a, b, want) => expect(titleSimilarity(a, b)).toBeCloseTo(want, 9))
  it.each(fixtures.findDuplicate.map((c) => [c.name, c] as const))('findDuplicate: %s', (_, c) => expect(findDuplicate(c.candidate, c.existing)).toEqual(c.expect))
})
