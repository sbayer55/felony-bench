import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DEGREE_LABELS, type Degree, type Incident, type Model, type Provider } from '../../data/schema'
import { scoreModels } from '../../lib/score'
import { Figure, LegendItem } from './Figure'
import { DEGREE_FILL, tickMono, tickSans, tooltipContent } from './theme'
import styles from './charts.module.css'

const TOP = 12
const BAR = 16
/** Worst first, so first-degree points sit on the baseline. */
const STACK: Degree[] = [3, 2, 1]
const key = (d: Degree) => `d${d}` as const

type Datum = { id: string; name: string; provider: string; total: number; d1: number; d2: number; d3: number }

interface SegmentProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: Datum
}

/** A stacked segment with a 4px rounded end, but only on the outermost non-empty segment of the bar. */
function segment(degree: Degree) {
  return function Segment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
    if (width <= 0) return null
    const outer = payload ? STACK.slice(STACK.indexOf(degree) + 1).every((d) => payload[key(d)] === 0) : false
    // Leave a 2px surface gap after every segment that has a neighbor.
    const w = outer ? width : Math.max(0, width - 2)
    const r = outer ? Math.min(4, w, height / 2) : 0
    const path = `M${x},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} Z`
    return <path d={path} fill={fill} />
  }
}

export function MostWanted({ incidents, models, providers }: { incidents: Incident[]; models: Model[]; providers: Provider[] }) {
  const navigate = useNavigate()
  const data = useMemo<Datum[]>(
    () =>
      scoreModels(models, providers, incidents)
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, TOP)
        .map((r) => {
          const pts = { d1: 0, d2: 0, d3: 0 }
          for (const inc of r.incidents) pts[key(inc.degree)] += inc.degree
          return { id: r.id, name: r.name, provider: r.providerName, total: r.score, ...pts }
        }),
    [incidents, models, providers],
  )

  if (data.length === 0) return <div className={styles.empty}>No incidents to chart.</div>

  return (
    <Figure
      exhibit="C"
      title="Most wanted"
      sub={`The top ${data.length} models by score, split by where the points came from. A first-degree count is worth three.`}
      legend={STACK.map((d) => (
        <LegendItem key={d} color={DEGREE_FILL[d]} label={DEGREE_LABELS[d]} />
      ))}
      table={{
        columns: ['Model', 'Provider', 'Score', 'First degree', 'Second degree', 'Third degree'],
        rows: data.map((d) => [d.name, d.provider, d.total, d.d3, d.d2, d.d1]),
      }}
    >
      <ResponsiveContainer width="100%" height={data.length * (BAR + 12) + 36}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barSize={BAR}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" allowDecimals={false} tick={tickMono} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} />
          <YAxis type="category" dataKey="name" width={150} tick={tickSans} tickLine={false} axisLine={false} interval={0} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            contentStyle={tooltipContent}
            labelStyle={{ color: 'var(--fg)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--fg)', padding: 0 }}
            labelFormatter={(name, payload) => {
              const p = payload?.[0]?.payload as Datum | undefined
              return p ? `${name} · ${p.provider} · ${p.total} pts` : String(name)
            }}
            formatter={(value, k) => [`${value} pts`, DEGREE_LABELS[Number(String(k).slice(1)) as Degree]]}
          />
          {STACK.map((d, i) => (
            <Bar
              key={d}
              dataKey={key(d)}
              stackId="score"
              fill={DEGREE_FILL[d]}
              shape={segment(d)}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(entry: { payload?: Datum }) => entry.payload && navigate(`/docket?m=${entry.payload.id}`)}
            >
              {i === STACK.length - 1 ? <LabelList dataKey="total" position="right" offset={6} style={{ fill: 'var(--fg)', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600 }} /> : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}
