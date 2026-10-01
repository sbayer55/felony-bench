import type { CSSProperties } from 'react'
import type { Degree, EvidenceClass, Incident, Provider } from '../../data/schema'

export const tickMono = { fill: 'var(--chart-ink)', fontSize: 11, fontFamily: 'var(--font-mono)' }
export const tickSans = { fill: 'var(--chart-ink)', fontSize: 12 }

export const tooltipContent: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--fg)',
  boxShadow: 'var(--shadow)',
}

export const SLOTS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'] as const

/**
 * A provider's color is fixed by its rank on the whole, unfiltered docket, so a filter never repaints a survivor.
 * Only the top eight get a hue; everyone else is muted.
 */
export function providerColors(providers: readonly Provider[], incidents: readonly Incident[]): Map<string, string> {
  const score = new Map<string, number>()
  for (const inc of incidents) for (const p of inc.providerIds) score.set(p, (score.get(p) ?? 0) + inc.degree)
  const ranked = [...providers].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.name.localeCompare(b.name))
  return new Map(ranked.map((p, i) => [p.id, i < SLOTS.length && (score.get(p.id) ?? 0) > 0 ? SLOTS[i] : 'var(--muted)']))
}

export const DEGREE_FILL: Record<Degree, string> = { 1: 'var(--deg1)', 2: 'var(--deg2)', 3: 'var(--deg3)' }

/** Five evidence classes are too many hues for a scatter, so the timeline folds them into three. */
export type EvidenceGroup = 'wild' | 'lab' | 'court'
export const EVIDENCE_GROUPS: readonly EvidenceGroup[] = ['wild', 'lab', 'court']
export const EVIDENCE_GROUP_OF: Record<EvidenceClass, EvidenceGroup> = {
  production: 'wild',
  alleged: 'wild',
  evaluation: 'lab',
  litigation: 'court',
  regulatory: 'court',
}
export const EVIDENCE_GROUP_LABEL: Record<EvidenceGroup, string> = {
  wild: 'In the wild',
  lab: 'In the lab',
  court: 'Courts & regulators',
}
export const EVIDENCE_GROUP_FILL: Record<EvidenceGroup, string> = { wild: 'var(--c2)', lab: 'var(--c1)', court: 'var(--c3)' }

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMonth(key: string): string {
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} '${key.slice(2, 4)}`
}
