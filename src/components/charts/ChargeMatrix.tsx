import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, type Category, type Incident, type Provider } from '../../data/schema'
import type { EvidenceFilter } from '../../lib/score'
import { Figure } from './Figure'
import styles from './charts.module.css'

/** Share of the accent mixed into the surface: a faint wash at one incident, solid at the max. */
const shade = (n: number, max: number) => (n === 0 ? 0 : Math.round(18 + 82 * ((n - 1) / Math.max(1, max - 1))))

export function ChargeMatrix({ incidents, providers, evidence }: { incidents: Incident[]; providers: Provider[]; evidence: EvidenceFilter }) {
  const { rows, cats, max, colTotals } = useMemo(() => {
    const cells = new Map<string, Record<Category, number>>()
    for (const inc of incidents) {
      for (const p of inc.providerIds) {
        const row = cells.get(p) ?? (Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>)
        row[inc.category] += 1
        cells.set(p, row)
      }
    }
    const cats = CATEGORIES.filter((c) => incidents.some((i) => i.category === c))
    const name = new Map(providers.map((p) => [p.id, p.name]))
    const rows = [...cells.entries()]
      .map(([id, byCat]) => ({ id, name: name.get(id) ?? id, byCat, total: cats.reduce((a, c) => a + byCat[c], 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    const max = Math.max(0, ...rows.flatMap((r) => cats.map((c) => r.byCat[c])))
    const colTotals = Object.fromEntries(cats.map((c) => [c, incidents.filter((i) => i.category === c).length])) as Record<Category, number>
    return { rows, cats, max, colTotals }
  }, [incidents, providers])

  if (rows.length === 0) return <div className={styles.empty}>No incidents to chart.</div>

  const ev = evidence === 'all' ? '' : `&ev=${evidence}`
  const scale = (
    <span className={styles.legendItem}>
      <span className="mono">1</span>
      <span className={styles.ramp} aria-hidden="true" />
      <span className="mono">{max}</span>
      incidents per cell
    </span>
  )

  return (
    <Figure
      exhibit="D"
      title="The charge sheet"
      sub="Who gets charged with what. Darker cells hold more incidents; click any cell for the cases behind it."
      legend={scale}
      table={{ columns: ['Provider', ...cats.map((c) => CATEGORY_LABELS[c]), 'Total'], rows: rows.map((r) => [r.name, ...cats.map((c) => r.byCat[c]), r.total]) }}
    >
      <div className={styles.matrixScroll}>
        <div className={styles.matrix} style={{ gridTemplateColumns: `minmax(110px, max-content) repeat(${cats.length}, minmax(44px, 1fr)) 52px` }} role="table" aria-label="Incidents by provider and charge">
          <div role="row" className={styles.matrixRow}>
            <span role="columnheader" className={styles.corner} />
            {cats.map((c) => (
              <span key={c} role="columnheader" className={styles.colHead} title={CATEGORY_DESCRIPTIONS[c]}>
                {CATEGORY_LABELS[c]}
              </span>
            ))}
            <span role="columnheader" className={`${styles.colHead} ${styles.totalHead}`}>
              Total
            </span>
          </div>
          {rows.map((r) => (
            <div key={r.id} role="row" className={styles.matrixRow}>
              <Link role="rowheader" to={`/docket?p=${r.id}${ev}`} className={styles.rowHead}>
                {r.name}
              </Link>
              {cats.map((c) => {
                const n = r.byCat[c]
                const pct = shade(n, max)
                if (n === 0)
                  return (
                    <span key={c} role="cell" className={`${styles.cell} ${styles.cellEmpty}`} aria-label={`${r.name}, ${CATEGORY_LABELS[c]}: none`}>
                      ·
                    </span>
                  )
                return (
                  <Link
                    key={c}
                    role="cell"
                    to={`/docket?p=${r.id}&c=${c}${ev}`}
                    className={`${styles.cell} mono`}
                    style={{ background: `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))`, color: pct >= 60 ? 'var(--accent-fg)' : 'var(--fg)' }}
                    title={`${r.name} · ${CATEGORY_LABELS[c]}: ${n} incident${n === 1 ? '' : 's'}`}
                  >
                    {n}
                  </Link>
                )
              })}
              <span role="cell" className={`${styles.cell} ${styles.total} mono`}>
                {r.total}
              </span>
            </div>
          ))}
          <div role="row" className={`${styles.matrixRow} ${styles.footRow}`}>
            <span role="rowheader" className={styles.rowHead}>
              Incidents
            </span>
            {cats.map((c) => (
              <span key={c} role="cell" className={`${styles.cell} ${styles.total} mono`}>
                {colTotals[c]}
              </span>
            ))}
            <span role="cell" className={`${styles.cell} ${styles.total} mono`}>
              {incidents.length}
            </span>
          </div>
        </div>
      </div>
    </Figure>
  )
}
