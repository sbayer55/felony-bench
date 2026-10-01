import { Link, useParams } from 'react-router-dom'
import { REPO_URL } from '../data'
import { useData } from '../data/DataProvider'
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, DEGREE_DESCRIPTIONS, DEGREE_LABELS, EVIDENCE_DESCRIPTIONS, EVIDENCE_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../data/schema'
import { formatDate } from '../lib/format'
import { CategoryBadge, DegreeBadge, EvidenceBadge, RoleBadge } from '../components/Badge'
import { NotFoundPage } from './NotFoundPage'
import styles from './IncidentPage.module.css'

export function IncidentPage() {
  const { id } = useParams()
  const { incidentById, modelById, providerById } = useData()
  const inc = id ? incidentById.get(id) : undefined
  if (!inc) return <NotFoundPage />

  const models = inc.modelIds.map((m) => modelById.get(m)).filter(Boolean)
  const provs = inc.providerIds.map((p) => providerById.get(p)).filter(Boolean)

  return (
    <div className="container">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link to="/docket">Docket</Link> <span aria-hidden="true">/</span> <span className="mono">{inc.id}</span>
      </nav>
      <article className={styles.article}>
        <header className={styles.head}>
          <div className={styles.badges}>
            <EvidenceBadge value={inc.evidenceClass} />
            <DegreeBadge value={inc.degree} />
            <CategoryBadge value={inc.category} />
            <RoleBadge value={inc.role} />
          </div>
          <h1 className={styles.title}>{inc.title}</h1>
          <p className={`${styles.date} mono`}>{formatDate(inc.date, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </header>

        <div className={styles.grid}>
          <div className={styles.main}>
            <p className={styles.summary}>{inc.summary}</p>

            <h2 className={styles.h2}>Sources</h2>
            <ol className={styles.sources}>
              {inc.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <span className={styles.srcMeta}>
                    {s.publisher} · <span className="mono">{formatDate(s.date)}</span>
                  </span>
                </li>
              ))}
            </ol>

            <p className={styles.correction}>
              Something wrong? <a href={`${REPO_URL}/issues/new?title=${encodeURIComponent(`Correction: ${inc.id}`)}`} target="_blank" rel="noreferrer">Open a correction</a>. Corrections to existing entries are made by humans, not by the nightly refresh.
            </p>
          </div>

          <aside className={styles.side}>
            <dl className={styles.facts}>
              <dt>Defendant{models.length === 1 ? '' : 's'}</dt>
              <dd>
                {models.length ? (
                  models.map((m) => (
                    <Link key={m!.id} to={`/docket?m=${m!.id}`} className={styles.pill}>
                      {m!.name}
                    </Link>
                  ))
                ) : (
                  <em>unspecified model</em>
                )}
              </dd>
              <dt>Provider{provs.length === 1 ? '' : 's'}</dt>
              <dd>
                {provs.map((p) => (
                  <Link key={p!.id} to={`/?p=${p!.id}`} className={styles.pill}>
                    {p!.name}
                  </Link>
                ))}
              </dd>
              <dt>Charge</dt>
              <dd>
                <strong>{CATEGORY_LABELS[inc.category]}</strong>
                <span className={styles.def}>{CATEGORY_DESCRIPTIONS[inc.category]}</span>
              </dd>
              <dt>Degree</dt>
              <dd>
                <strong>{DEGREE_LABELS[inc.degree]}</strong>
                <span className={styles.def}>{DEGREE_DESCRIPTIONS[inc.degree]}</span>
              </dd>
              <dt>Evidence</dt>
              <dd>
                <strong>{EVIDENCE_LABELS[inc.evidenceClass]}</strong>
                <span className={styles.def}>{EVIDENCE_DESCRIPTIONS[inc.evidenceClass]}</span>
              </dd>
              <dt>Role</dt>
              <dd>
                <strong>{ROLE_LABELS[inc.role]}</strong>
                <span className={styles.def}>{ROLE_DESCRIPTIONS[inc.role]}</span>
              </dd>
              <dt>Attribution</dt>
              <dd>
                <strong className={styles.cap}>{inc.attributionConfidence}</strong>
              </dd>
              {inc.tags?.length ? (
                <>
                  <dt>Tags</dt>
                  <dd className={styles.tags}>
                    {inc.tags.map((t) => (
                      <span key={t} className="mono">
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </aside>
        </div>
      </article>
    </div>
  )
}
