import { Link } from 'react-router-dom'
import type { Incident } from '../data/schema'
import { modelById, providerById } from '../data'
import { formatDate } from '../lib/format'
import { CategoryBadge, DegreeBadge, EvidenceBadge, RoleBadge } from './Badge'
import styles from './IncidentCard.module.css'

export function IncidentCard({ incident, compact = false }: { incident: Incident; compact?: boolean }) {
  const models = incident.modelIds.map((id) => modelById.get(id)?.name ?? id)
  const providers = incident.providerIds.map((id) => providerById.get(id)?.name ?? id)
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={`${styles.date} mono`}>{formatDate(incident.date)}</span>
        <span className={styles.badges}>
          <EvidenceBadge value={incident.evidenceClass} />
          <DegreeBadge value={incident.degree} />
        </span>
      </header>
      <h3 className={styles.title}>
        <Link to={`/docket/${incident.id}`}>{incident.title}</Link>
      </h3>
      <p className={styles.who}>
        <span className={styles.whoLabel}>Defendant</span>
        {models.length > 0 ? models.join(', ') : <em>unspecified model</em>}
        <span className={styles.sep}>·</span>
        {providers.join(', ')}
      </p>
      {!compact ? <p className={styles.summary}>{incident.summary}</p> : null}
      <footer className={styles.foot}>
        <span className={styles.badges}>
          <CategoryBadge value={incident.category} />
          <RoleBadge value={incident.role} />
        </span>
        <span className={styles.sources}>
          {incident.sources.length} source{incident.sources.length === 1 ? '' : 's'} · {incident.sources[0].publisher}
        </span>
      </footer>
    </article>
  )
}
