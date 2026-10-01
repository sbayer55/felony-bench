import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CATEGORIES, CATEGORY_LABELS, type Category, type Incident, type Provider } from '../../data/schema'
import styles from './charts.module.css'

const SLOT: Record<Category, string> = {
  'unauthorized-access': 'var(--c1)',
  'data-breach': 'var(--c2)',
  'containment-escape': 'var(--c3)',
  deception: 'var(--c4)',
  destruction: 'var(--c5)',
  extortion: 'var(--c6)',
  fabrication: 'var(--c7)',
  accessory: 'var(--c8)',
  copyright: 'var(--muted)',
  other: 'var(--line-strong)',
}

export function CategoryByProvider({ incidents, providers }: { incidents: Incident[]; providers: Provider[] }) {
  const { data, cats } = useMemo(() => {
    const byProvider = new Map<string, Record<string, number>>()
    const seen = new Set<Category>()
    for (const inc of incidents) {
      seen.add(inc.category)
      for (const pid of inc.providerIds) {
        const row = byProvider.get(pid) ?? {}
        row[inc.category] = (row[inc.category] ?? 0) + 1
        byProvider.set(pid, row)
      }
    }
    const name = new Map(providers.map((p) => [p.id, p.name]))
    const data = [...byProvider.entries()]
      .map(([pid, row]) => ({ provider: name.get(pid) ?? pid, total: Object.values(row).reduce((a, b) => a + b, 0), ...row }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
    const cats = CATEGORIES.filter((c) => seen.has(c))
    return { data, cats }
  }, [incidents, providers])

  if (data.length === 0) return <div className={styles.empty}>No incidents to chart.</div>

  return (
    <figure className={styles.fig}>
      <figcaption className={styles.cap}>
        <span className={styles.capTitle}>Incidents by provider and charge</span>
        <span className={styles.capSub}>Top {data.length} providers. An incident naming two providers counts for both.</span>
      </figcaption>
      <div className={styles.plot}>
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 30 + 60)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--chart-ink)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} />
            <YAxis type="category" dataKey="provider" width={120} tick={{ fill: 'var(--chart-ink)', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, color: 'var(--fg)' }}
              labelStyle={{ color: 'var(--fg)', fontWeight: 600 }}
              formatter={(value, name) => [String(value), CATEGORY_LABELS[name as Category] ?? String(name)]}
            />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: 'var(--chart-ink)' }} formatter={(v) => CATEGORY_LABELS[v as Category] ?? v} />
            {cats.map((c) => (
              <Bar key={c} dataKey={c} stackId="a" fill={SLOT[c]} stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
