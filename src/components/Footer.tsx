import { Link } from 'react-router-dom'
import { ACTIONS_URL, REPO_URL, meta } from '../data'
import { relativeTime } from '../lib/format'
import styles from './Footer.module.css'

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.disclaimer}>
          No model or provider listed on this site has been charged with or convicted of a crime. Scores are an editorial
          tally of publicly reported incidents, each linked to its source. Large language models have no legal personhood
          and cannot commit felonies. We score them anyway. See the <Link to="/methodology">methodology</Link>.
        </p>
        <div className={styles.meta}>
          <span>
            {meta.lastRefreshed ? (
              <>
                Last automated refresh <span className="mono">{relativeTime(meta.lastRefreshed)}</span> ·{' '}
                <span className="mono">+{meta.lastRunAdded}</span> added
              </>
            ) : (
              'Daily refresh has not run yet'
            )}
          </span>
          <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
            Request refresh
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </div>
    </footer>
  )
}
