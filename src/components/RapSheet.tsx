import { Link } from 'react-router-dom'
import type { Row } from '../lib/score'
import { formatDate } from '../lib/format'
import { CategoryBadge, DegreeBadge, EvidenceBadge, RoleBadge } from './Badge'
import styles from './RapSheet.module.css'

export function RapSheet({ row }: { row: Row }) {
  return (
    <div className={styles.sheet}>
      <div className={styles.head}>
        <span className={styles.title}>Rap sheet</span>
        <span className={styles.meta}>
          <span className="mono">{row.count}</span> incident{row.count === 1 ? '' : 's'} ·{' '}
          <Link to={`/docket?${row.kind === 'model' ? 'm' : 'p'}=${row.id}`}>open in docket</Link>
        </span>
      </div>
      <ol className={styles.list}>
        {row.incidents.map((inc) => (
          <li key={inc.id} className={styles.item}>
            <span className={`${styles.date} mono`}>{formatDate(inc.date, { year: 'numeric', month: 'short' })}</span>
            <div className={styles.body}>
              <Link to={`/docket/${inc.id}`} className={styles.itemTitle}>
                {inc.title}
              </Link>
              <div className={styles.badges}>
                <EvidenceBadge value={inc.evidenceClass} />
                <CategoryBadge value={inc.category} />
                <RoleBadge value={inc.role} />
                <DegreeBadge value={inc.degree} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
