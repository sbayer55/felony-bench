import { Fragment, useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../data/schema'
import { assignRanks, sortRows, type Row, type SortDir, type SortKey } from '../lib/score'
import { formatDate, formatScore, initials } from '../lib/format'
import { EvidenceBadge } from './Badge'
import { RapSheet } from './RapSheet'
import styles from './Leaderboard.module.css'

interface Props {
  rows: Row[]
  /** Ranks are computed over the unfiltered set so a filter doesn't promote anyone. */
  rankSource: Row[]
  activeCategories: ReadonlySet<Category>
}

type Col = { key: SortKey; label: string; title?: string; align?: 'right' | 'left'; cat?: Category }

export function Leaderboard({ rows, rankSource, activeCategories }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [open, setOpen] = useState<string | null>(null)

  const ranks = useMemo(() => assignRanks(rankSource), [rankSource])
  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir])

  const catCols: Category[] = CATEGORIES.filter((c) => c !== 'other' && (rankSource.some((r) => r.byCategory[c] > 0) || activeCategories.has(c)))

  const cols: Col[] = [
    { key: 'rank', label: '#', align: 'right' },
    { key: 'name', label: rows[0]?.kind === 'provider' ? 'Provider' : 'Model' },
    ...(rows[0]?.kind === 'provider' ? [] : [{ key: 'provider', label: 'Provider' } as Col]),
    { key: 'score', label: 'Felony Score', title: 'Sum of incident degrees', align: 'right' },
    { key: 'count', label: 'Incidents', align: 'right' },
    ...catCols.map((c) => ({ key: c, label: CATEGORY_LABELS[c], align: 'right', cat: c }) as Col),
    { key: 'last', label: 'Last incident' },
  ]

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'provider' ? 'asc' : 'desc')
    }
  }

  const clean = rows.filter((r) => r.count === 0).length

  return (
    <div className={styles.wrap}>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`${c.align === 'right' ? styles.right : ''} ${c.cat && activeCategories.has(c.cat) ? styles.thActive : ''}`} aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => onSort(c.key)} title={c.title} className={styles.sortBtn}>
                    {c.label}
                    <span className={styles.arrow} aria-hidden="true">
                      {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              ))}
              <th className={styles.right}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 1} className={styles.emptyRow}>
                  Nothing matches these filters. Either the field is clean or your filters are.
                </td>
              </tr>
            ) : null}
            {sorted.map((r) => {
              const rank = ranks.get(r.id) ?? null
              const isOpen = open === r.id
              const expandable = r.count > 0
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`${styles.row} ${r.count === 0 ? styles.clean : ''} ${isOpen ? styles.open : ''} ${expandable ? styles.expandable : ''}`}
                    onClick={() => expandable && setOpen(isOpen ? null : r.id)}
                    aria-expanded={expandable ? isOpen : undefined}
                  >
                    <td className={`${styles.right} ${styles.rank} mono`}>
                      {rank === null ? <span className={styles.dash}>—</span> : <span className={rank === 1 ? styles.first : ''}>{rank}</span>}
                    </td>
                    <td className={styles.nameCell}>
                      <span className={styles.avatar} aria-hidden="true">
                        {initials(r.kind === 'provider' ? r.name : r.providerName)}
                      </span>
                      <span className={styles.name}>{r.name}</span>
                      {expandable ? (
                        <span className={styles.chev} aria-hidden="true">
                          {isOpen ? '▾' : '▸'}
                        </span>
                      ) : null}
                    </td>
                    {r.kind === 'provider' ? null : <td className={styles.provider}>{r.providerName}</td>}
                    <td className={`${styles.right} ${styles.score} mono`}>
                      {r.score === 0 ? (
                        <span className={styles.cleanScore}>
                          0.00 <span className={styles.cleanNote}>clean record (so far)</span>
                        </span>
                      ) : (
                        formatScore(r.score)
                      )}
                    </td>
                    <td className={`${styles.right} mono`}>{r.count || <span className={styles.dash}>—</span>}</td>
                    {catCols.map((c) => (
                      <td key={c} className={`${styles.right} mono ${activeCategories.has(c) ? styles.tdActive : ''}`}>
                        {r.byCategory[c] || <span className={styles.dash}>·</span>}
                      </td>
                    ))}
                    <td className={`${styles.last} mono`}>{r.lastIncident ? formatDate(r.lastIncident) : <span className={styles.dash}>—</span>}</td>
                    <td className={styles.right}>
                      <span className={styles.badges}>
                        {r.evidence.map((e) => (
                          <EvidenceBadge key={e} value={e} />
                        ))}
                      </span>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className={styles.detail}>
                      <td colSpan={cols.length + 1}>
                        <RapSheet row={r} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.foot}>
        <span>
          <span className="mono">{rows.length}</span> {rows[0]?.kind === 'provider' ? 'providers' : 'models'} shown
          {clean > 0 ? (
            <>
              {' '}
              · <span className="mono">{clean}</span> with a clean record
            </>
          ) : null}
        </span>
        <span>Click a row with incidents to read its rap sheet.</span>
      </div>
    </div>
  )
}
