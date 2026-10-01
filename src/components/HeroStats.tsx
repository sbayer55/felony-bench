import { Link } from 'react-router-dom'
import type { Stats } from '../lib/score'
import { daysSince, formatDate, formatScore } from '../lib/format'
import styles from './HeroStats.module.css'

export function HeroStats({ stats, totalModels, scope }: { stats: Stats; totalModels: number; scope: string }) {
  const days = daysSince(stats.lastIncident)
  const leader = stats.leader
  return (
    <section className={styles.hero} aria-label="Benchmark summary">
      <div className={styles.copy}>
        <h1 className={styles.title}>Open LLM Felony Leaderboard</h1>
        <p className={styles.lede}>
          One benchmark. No test set, no held-out split, no contamination concerns. Every model starts at zero and is
          graded on documented criminal-adjacent conduct in the wild and in the lab. Unlike other benchmarks, this one is
          not saturating.
        </p>
        <p className={styles.scope}>
          Showing <strong>{scope}</strong>
        </p>
      </div>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.label}>Felonies logged</span>
          <span className={`${styles.value} mono`}>{stats.incidents}</span>
          <span className={styles.sub}>
            total score <span className="mono">{formatScore(stats.totalScore)}</span>
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Models implicated</span>
          <span className={`${styles.value} mono`}>{stats.modelsImplicated}</span>
          <span className={styles.sub}>
            of <span className="mono">{totalModels}</span> on the roster
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Days since last incident</span>
          <span className={`${styles.value} mono`}>{days ?? '—'}</span>
          <span className={styles.sub}>{stats.lastIncident ? formatDate(stats.lastIncident) : 'no incidents on record'}</span>
        </div>
        <div className={`${styles.tile} ${styles.leader}`}>
          <span className={styles.label}>Current leader</span>
          {leader ? (
            <>
              <span className={styles.leaderName}>
                <Link to={`/docket?${leader.kind === 'model' ? 'm' : 'p'}=${leader.id}`}>{leader.name}</Link>
              </span>
              <span className={styles.sub}>
                {leader.providerName} · score <span className="mono">{formatScore(leader.score)}</span>
              </span>
            </>
          ) : (
            <>
              <span className={styles.leaderName}>Nobody</span>
              <span className={styles.sub}>a clean field, for now</span>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
