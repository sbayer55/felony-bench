import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useDataStatus } from '../data/DataProvider'
import styles from './DataGate.module.css'

/** Layout route: renders its child routes once /api/bootstrap has loaded. */
export function DataGate() {
  const status = useDataStatus()
  const [retrying, setRetrying] = useState(false)

  if (status.state === 'ready') return <Outlet />

  if (status.state === 'loading') {
    return (
      <div className="container">
        <div className={styles.panel} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Calling the docket…
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className={`${styles.panel} ${styles.error}`} role="alert">
        <div>
          <h1 className={styles.title}>Court is not in session</h1>
          <p className={styles.msg}>The docket could not be loaded. {status.message}</p>
        </div>
        <button
          type="button"
          className={styles.retry}
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            await status.reload()
            setRetrying(false)
          }}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
