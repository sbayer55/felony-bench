import { NavLink } from 'react-router-dom'
import { useTheme } from '../lib/useTheme'
import styles from './Header.module.css'

const nav = [
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/docket', label: 'Docket' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/about', label: 'About' },
]

export function Header() {
  const [, toggle, isDark] = useTheme()
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <NavLink to="/" className={styles.brand} end>
          <span className={styles.mark} aria-hidden="true">
            ⚖️
          </span>
          <span className={styles.brandText}>
            <span className={styles.name}>Felony Bench</span>
            <span className={styles.tag}>Open LLM Felony Leaderboard</span>
          </span>
        </NavLink>
        <nav className={styles.nav} aria-label="Primary">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.actions}>
          <button type="button" className={styles.iconBtn} onClick={toggle} aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} title={isDark ? 'Light theme' : 'Dark theme'}>
            {isDark ? '☀' : '☾'}
          </button>
          <NavLink to="/submit" className={styles.submit}>
            Submit a felony
          </NavLink>
        </div>
      </div>
    </header>
  )
}
