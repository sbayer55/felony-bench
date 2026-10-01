import type { Category, Degree, EvidenceClass, Role } from '../data/schema'
import { CATEGORY_LABELS, DEGREE_LABELS, EVIDENCE_LABELS, ROLE_LABELS } from '../data/schema'
import styles from './Badge.module.css'

export function EvidenceBadge({ value, title }: { value: EvidenceClass; title?: string }) {
  return (
    <span className={`${styles.badge} ${styles[`ev_${value}`]}`} title={title ?? value}>
      {EVIDENCE_LABELS[value]}
    </span>
  )
}

export function CategoryBadge({ value }: { value: Category }) {
  return <span className={`${styles.badge} ${styles.cat}`}>{CATEGORY_LABELS[value]}</span>
}

export function RoleBadge({ value }: { value: Role }) {
  return <span className={`${styles.badge} ${styles.role}`}>{ROLE_LABELS[value]}</span>
}

export function DegreeBadge({ value }: { value: Degree }) {
  return (
    <span className={`${styles.badge} ${styles.degree} ${styles[`deg_${value}`]}`} title={`Degree ${value}`}>
      {DEGREE_LABELS[value]}
    </span>
  )
}
