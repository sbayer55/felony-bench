import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Incident } from '../../data/schema'
import styles from './charts.module.css'

function quarter(iso: string): string {
  const y = iso.slice(0, 4)
  const m = Number(iso.slice(5, 7))
  return `${y} Q${Math.ceil(m / 3)}`
}

function nextQuarter(q: string): string {
  const [y, qq] = q.split(' Q')
  const n = Number(qq)
  return n === 4 ? `${Number(y) + 1} Q1` : `${y} Q${n + 1}`
}

export function IncidentsOverTime({ incidents }: { incidents: Incident[] }) {
  const data = useMemo(() => {
    if (incidents.length === 0) return []
    const counts = new Map<string, number>()
    for (const inc of incidents) counts.set(quarter(inc.date), (counts.get(quarter(inc.date)) ?? 0) + 1)
    const keys = [...counts.keys()].sort()
    const out: { q: string; n: number; cum: number }[] = []
    let cum = 0
    for (let q = keys[0]; q <= keys[keys.length - 1]; q = nextQuarter(q)) {
      const n = counts.get(q) ?? 0
      cum += n
      out.push({ q, n, cum })
    }
    return out
  }, [incidents])

  if (data.length === 0) {
    return <div className={styles.empty}>No incidents to chart.</div>
  }

  return (
    <figure className={styles.fig}>
      <figcaption className={styles.cap}>
        <span className={styles.capTitle}>Cumulative incidents by quarter</span>
        <span className={styles.capSub}>The only benchmark curve that goes up and is bad news.</span>
      </figcaption>
      <div className={styles.plot}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="q" tick={{ fill: 'var(--chart-ink)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--chart-ink)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)' }}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, color: 'var(--fg)' }}
              labelStyle={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
              formatter={(value, name) => [String(value), name === 'cum' ? 'Cumulative' : 'This quarter']}
            />
            <Area type="monotone" dataKey="cum" name="cum" stroke="var(--c1)" strokeWidth={2} fill="var(--c1)" fillOpacity={0.12} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
