import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Incident, Provider } from '../../data/schema'
import { Figure, LegendItem } from './Figure'
import { formatMonth, monthKey, nextMonth, tickMono, tooltipContent } from './theme'
import styles from './charts.module.css'

const MAX_SERIES = 6

interface Props {
  incidents: Incident[]
  providers: Provider[]
  colors: Map<string, string>
  /** When the viewer has picked providers, race those instead of the leaders. */
  only?: ReadonlySet<string>
}

export function ScoreRace({ incidents, providers, colors, only }: Props) {
  const { data, series } = useMemo(() => {
    const total = new Map<string, number>()
    for (const inc of incidents) for (const p of inc.providerIds) total.set(p, (total.get(p) ?? 0) + inc.degree)
    const name = new Map(providers.map((p) => [p.id, p.name]))
    const series = [...total.entries()]
      .filter(([id]) => !only?.size || only.has(id))
      .sort((a, b) => b[1] - a[1] || (name.get(a[0]) ?? a[0]).localeCompare(name.get(b[0]) ?? b[0]))
      .slice(0, MAX_SERIES)
      .map(([id, score]) => ({ id, name: name.get(id) ?? id, score }))
    if (series.length === 0) return { data: [], series }

    const byMonth = new Map<string, Map<string, number>>()
    for (const inc of incidents) {
      const m = byMonth.get(monthKey(inc.date)) ?? new Map<string, number>()
      for (const p of inc.providerIds) m.set(p, (m.get(p) ?? 0) + inc.degree)
      byMonth.set(monthKey(inc.date), m)
    }
    const months = [...byMonth.keys()].sort()
    const running = new Map<string, number>()
    const data: Record<string, string | number>[] = []
    for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth(m)) {
      const row: Record<string, string | number> = { m }
      for (const s of series) {
        running.set(s.id, (running.get(s.id) ?? 0) + (byMonth.get(m)?.get(s.id) ?? 0))
        row[s.id] = running.get(s.id) ?? 0
      }
      data.push(row)
    }
    return { data, series }
  }, [incidents, providers, only])

  if (series.length === 0) return <div className={styles.empty}>No incidents to chart.</div>

  const nameOf = new Map(series.map((s) => [s.id, s.name]))
  const yearTicks = data.map((d) => String(d.m)).filter((m) => m.endsWith('-01'))

  return (
    <Figure
      exhibit="B"
      title="The race to the bottom"
      sub={`Cumulative score by provider, month by month. ${only?.size ? 'Selected providers' : `Top ${series.length} in scope`}; the number is where each one stands today.`}
      legend={series.map((s) => (
        <LegendItem key={s.id} shape="line" color={colors.get(s.id) ?? 'var(--muted)'} label={s.name} value={s.score} />
      ))}
      table={{
        columns: ['Month', ...series.map((s) => s.name)],
        rows: data.filter((d, i) => i === data.length - 1 || series.some((s) => d[s.id] !== data[i + 1]?.[s.id])).map((d) => [formatMonth(String(d.m)), ...series.map((s) => Number(d[s.id]))]),
      }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="m" ticks={yearTicks} tickFormatter={(m: string) => m.slice(0, 4)} tick={tickMono} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} minTickGap={16} />
          <YAxis allowDecimals={false} tick={tickMono} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)' }}
            contentStyle={tooltipContent}
            labelStyle={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}
            itemStyle={{ color: 'var(--fg)', padding: 0 }}
            labelFormatter={(m) => formatMonth(String(m))}
            itemSorter={(item) => -Number(item.value)}
            formatter={(value, id) => [String(value), nameOf.get(String(id)) ?? String(id)]}
          />
          {series.map((s) => (
            <Line
              key={s.id}
              dataKey={s.id}
              type="stepAfter"
              stroke={colors.get(s.id) ?? 'var(--muted)'}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Figure>
  )
}
