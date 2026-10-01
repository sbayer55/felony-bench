import type { ReactNode } from 'react'
import styles from './charts.module.css'

export interface FigureTable {
  columns: string[]
  rows: (string | number)[][]
}

interface Props {
  exhibit?: string
  title: string
  sub?: ReactNode
  legend?: ReactNode
  table?: FigureTable
  children: ReactNode
}

/** A chart card: caption, optional legend row, the plot, and the same numbers as a table for anyone who can't read the plot. */
export function Figure({ exhibit, title, sub, legend, table, children }: Props) {
  return (
    <figure className={styles.fig}>
      <figcaption className={styles.cap}>
        <span className={styles.capTitle}>
          {exhibit ? <span className={styles.exhibit}>Exhibit {exhibit}</span> : null}
          {title}
        </span>
        {sub ? <span className={styles.capSub}>{sub}</span> : null}
      </figcaption>
      {legend ? <div className={styles.legend}>{legend}</div> : null}
      <div className={styles.plot}>{children}</div>
      {table && table.rows.length > 0 ? (
        <details className={styles.tableView}>
          <summary>View as table</summary>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j} className={typeof v === 'number' ? 'mono' : undefined}>{v}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  )
}

export function LegendItem({ color, label, value, shape = 'square' }: { color: string; label: ReactNode; value?: ReactNode; shape?: 'square' | 'line' | 'dot' }) {
  return (
    <span className={styles.legendItem}>
      <span className={`${styles.swatch} ${styles[shape]}`} style={{ background: color }} aria-hidden="true" />
      {label}
      {value !== undefined ? <span className={`${styles.legendValue} mono`}>{value}</span> : null}
    </span>
  )
}
