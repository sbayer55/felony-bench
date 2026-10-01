import { describe, expect, it } from 'vitest'
import { daysSince, formatScore, initials, ordinal, relativeTime, slugify } from './format'

describe('format', () => {
  it('daysSince counts whole UTC days', () => {
    expect(daysSince('2025-01-01', new Date('2025-01-11T12:00:00Z'))).toBe(10)
    expect(daysSince(null)).toBeNull()
  })
  it('relativeTime buckets', () => {
    const now = new Date('2025-01-02T00:00:00Z')
    expect(relativeTime('2025-01-01T23:30:00Z', now)).toBe('30 min ago')
    expect(relativeTime('2025-01-01T12:00:00Z', now)).toBe('12 h ago')
    expect(relativeTime('2024-12-20T00:00:00Z', now)).toBe('13 d ago')
    expect(relativeTime(null)).toBe('never')
  })
  it('misc', () => {
    expect(formatScore(7)).toBe('7.00')
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(13)).toBe('13th')
    expect(initials('Google DeepMind')).toBe('GD')
    expect(initials('Alibaba (Qwen)')).toBe('A')
    expect(slugify('Replit Agent deletes SaaStr’s DB!')).toBe('replit-agent-deletes-saastr-s-db')
  })
})
