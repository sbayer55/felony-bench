import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORIES, CATEGORY_LABELS, DEGREE_LABELS, EVIDENCE_LABELS, type Category, type Incident } from '../../data/schema'
import { formatDate, parseDate } from '../../lib/format'
import { Figure, LegendItem } from './Figure'
import { EVIDENCE_GROUPS, EVIDENCE_GROUP_FILL, EVIDENCE_GROUP_LABEL, EVIDENCE_GROUP_OF } from './theme'
import { useWidth } from './useWidth'
import styles from './charts.module.css'

const ROW_H = 40
const M = { top: 6, right: 14, bottom: 26, left: 108 }
const RADIUS = { 1: 4, 2: 5.5, 3: 7.5 } as const

interface Dot {
  inc: Incident
  x: number
  y: number
  r: number
}

/** Greedy beeswarm: walk each row in date order and nudge a dot up or down until it clears its neighbors. */
function swarm(row: Incident[], cy: number, x: (iso: string) => number): Dot[] {
  const placed: Dot[] = []
  const limit = ROW_H / 2 - 2
  for (const inc of [...row].sort((a, b) => a.date.localeCompare(b.date) || b.degree - a.degree)) {
    const r = RADIUS[inc.degree]
    const cx = x(inc.date)
    let y = cy
    for (let k = 0; k < 24; k++) {
      const dy = k === 0 ? 0 : Math.ceil(k / 2) * 3 * (k % 2 ? -1 : 1)
      if (Math.abs(dy) > limit - r) break
      y = cy + dy
      if (placed.every((p) => Math.hypot(p.x - cx, p.y - y) >= p.r + r + 1.5)) break
    }
    placed.push({ inc, x: cx, y, r })
  }
  return placed
}

export function DocketTimeline({ incidents }: { incidents: Incident[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const navigate = useNavigate()

  const layout = useMemo(() => {
    if (incidents.length === 0) return null
    const rows = CATEGORIES.filter((c) => incidents.some((i) => i.category === c))
    const dates = incidents.map((i) => i.date).sort()
    const y0 = Number(dates[0].slice(0, 4))
    const y1 = Number(dates[dates.length - 1].slice(0, 4))
    const t0 = Date.UTC(y0, 0, 1)
    // End a month past the latest incident so the newest dot isn't pinned to the edge.
    const t1 = parseDate(dates[dates.length - 1]).getTime() + 31 * 86_400_000
    const plotW = Math.max(120, width - M.left - M.right)
    const x = (iso: string) => M.left + ((parseDate(iso).getTime() - t0) / (t1 - t0)) * plotW
    const halfYears = plotW / ((t1 - t0) / (365 * 86_400_000)) > 220
    const ticks: { x: number; label: string; major: boolean }[] = []
    for (let y = y0; y <= y1; y++) {
      ticks.push({ x: x(`${y}-01-01`), label: String(y), major: true })
      if (halfYears && parseDate(`${y}-07-01`).getTime() < t1) ticks.push({ x: x(`${y}-07-01`), label: 'Jul', major: false })
    }
    const byRow = new Map<Category, Incident[]>()
    for (const inc of incidents) byRow.set(inc.category, [...(byRow.get(inc.category) ?? []), inc])
    const dots = rows.flatMap((c, i) => swarm(byRow.get(c) ?? [], M.top + i * ROW_H + ROW_H / 2, x))
    return { rows, byRow, ticks, dots, height: M.top + rows.length * ROW_H + M.bottom }
  }, [incidents, width])

  if (!layout) return <div className={styles.empty}>No incidents to chart.</div>

  const hot = layout.dots.find((d) => d.inc.id === active)
  const legend = (
    <>
      {EVIDENCE_GROUPS.map((g) => (
        <LegendItem key={g} shape="dot" color={EVIDENCE_GROUP_FILL[g]} label={EVIDENCE_GROUP_LABEL[g]} />
      ))}
      <span className={styles.legendSep} aria-hidden="true" />
      <span className={styles.legendItem}>
        Size is degree:
        <svg width="62" height="16" aria-hidden="true">
          {([1, 2, 3] as const).map((d, i) => (
            <circle key={d} cx={8 + i * 21} cy={8} r={RADIUS[d]} fill="none" stroke="var(--chart-ink)" strokeWidth={1.25} />
          ))}
        </svg>
        <span className="mono">3rd → 1st</span>
      </span>
    </>
  )

  return (
    <Figure
      exhibit="A"
      title="The docket, on a timeline"
      sub="Every incident in scope, by charge and date. Bigger dots are higher degrees. Hover for the charge, click to open the case file."
      legend={legend}
      table={{
        columns: ['Charge', 'Incidents', 'In the wild', 'In the lab', 'Courts & regulators', 'Most recent'],
        rows: layout.rows.map((c) => {
          const list = layout.byRow.get(c) ?? []
          const n = (g: string) => list.filter((i) => EVIDENCE_GROUP_OF[i.evidenceClass] === g).length
          return [CATEGORY_LABELS[c], list.length, n('wild'), n('lab'), n('court'), formatDate(list.map((i) => i.date).sort().at(-1))]
        }),
      }}
    >
      <div ref={ref} className={styles.timeline}>
        <svg width={width} height={layout.height} role="img" aria-label={`Timeline of ${incidents.length} incidents by charge`} onMouseLeave={() => setActive(null)}>
          {layout.rows.map((c, i) => {
            const top = M.top + i * ROW_H
            return (
              <g key={c}>
                {i > 0 ? <line x1={0} x2={width - M.right} y1={top} y2={top} stroke="var(--chart-grid)" /> : null}
                <text x={0} y={top + ROW_H / 2} dy="0.35em" fontSize={12} fill="var(--fg-2)">
                  {CATEGORY_LABELS[c]}
                  <tspan dx={6} fontFamily="var(--font-mono)" fontSize={11} fill="var(--muted)">
                    {layout.byRow.get(c)?.length}
                  </tspan>
                </text>
              </g>
            )
          })}
          {layout.ticks.map((t) => (
            <g key={`${t.label}-${t.x}`}>
              <line x1={t.x} x2={t.x} y1={M.top} y2={layout.height - M.bottom} stroke="var(--chart-grid)" strokeOpacity={t.major ? 1 : 0.5} />
              <text x={t.x} y={layout.height - 8} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill={t.major ? 'var(--chart-ink)' : 'var(--muted)'}>
                {t.label}
              </text>
            </g>
          ))}
          {layout.dots.map((d) => {
            const on = d.inc.id === active
            return (
              <a
                key={d.inc.id}
                href={`/docket/${d.inc.id}`}
                aria-label={`${formatDate(d.inc.date)}: ${d.inc.title}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/docket/${d.inc.id}`)
                }}
                onMouseEnter={() => setActive(d.inc.id)}
                onFocus={() => setActive(d.inc.id)}
                onBlur={() => setActive(null)}
                className={styles.dotLink}
              >
                <circle cx={d.x} cy={d.y} r={Math.max(d.r + 4, 9)} fill="transparent" />
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={d.r}
                  fill={EVIDENCE_GROUP_FILL[EVIDENCE_GROUP_OF[d.inc.evidenceClass]]}
                  stroke={on ? 'var(--fg)' : 'var(--surface)'}
                  strokeWidth={2}
                  opacity={active && !on ? 0.35 : 1}
                />
              </a>
            )
          })}
          {/* Redraw the active dot last so its ring sits on top of its neighbors. */}
          {hot ? <circle cx={hot.x} cy={hot.y} r={hot.r} fill={EVIDENCE_GROUP_FILL[EVIDENCE_GROUP_OF[hot.inc.evidenceClass]]} stroke="var(--fg)" strokeWidth={2} pointerEvents="none" /> : null}
        </svg>
        {hot ? (
          <div className={styles.tip} style={{ left: Math.max(0, Math.min(hot.x + 14, width - 290)), top: hot.y + 12 }}>
            <span className={styles.tipMeta}>
              {formatDate(hot.inc.date)} · {EVIDENCE_LABELS[hot.inc.evidenceClass]} · {DEGREE_LABELS[hot.inc.degree]}
            </span>
            <span className={styles.tipTitle}>{hot.inc.title}</span>
          </div>
        ) : null}
      </div>
    </Figure>
  )
}
