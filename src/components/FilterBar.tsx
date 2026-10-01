import { CATEGORIES, CATEGORY_LABELS, type Category } from '../data/schema'
import type { Provider } from '../data/schema'
import type { EvidenceFilter } from '../lib/score'
import type { FilterState } from '../lib/useFilters'
import styles from './FilterBar.module.css'

interface Props {
  state: FilterState
  update: (patch: Partial<FilterState>) => void
  reset: () => void
  active: boolean
  providers: Provider[]
  providerCounts: Map<string, number>
  categoryCounts: Record<Category, number>
  showView?: boolean
  showClean?: boolean
}

const EVIDENCE: { value: EvidenceFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All evidence', title: 'Everything on the docket' },
  { value: 'production', label: 'Outside the lab', title: 'Production, alleged, litigation, and regulatory. Excludes lab evaluations.' },
  { value: 'evaluation', label: 'Lab only', title: 'Only behavior observed in evaluations and system cards.' },
]

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export function FilterBar({ state, update, reset, active, providers, providerCounts, categoryCounts, showView = true, showClean = true }: Props) {
  const implicated = providers.filter((p) => (providerCounts.get(p.id) ?? 0) > 0)
  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <label className={styles.search}>
          <span className="sr-only">Search models and providers</span>
          <input
            id="filter-query"
            type="search"
            placeholder="Search models or providers"
            value={state.query}
            onChange={(e) => update({ query: e.target.value })}
          />
        </label>
        {showView ? (
          <div className={styles.segment} role="group" aria-label="View">
            <button type="button" className={state.view === 'models' ? styles.on : ''} onClick={() => update({ view: 'models' })}>
              Models
            </button>
            <button type="button" className={state.view === 'providers' ? styles.on : ''} onClick={() => update({ view: 'providers' })}>
              Providers
            </button>
          </div>
        ) : null}
        <div className={styles.segment} role="group" aria-label="Evidence class">
          {EVIDENCE.map((e) => (
            <button key={e.value} type="button" title={e.title} className={state.evidence === e.value ? styles.on : ''} onClick={() => update({ evidence: e.value })}>
              {e.label}
            </button>
          ))}
        </div>
        {showClean ? (
          <label className={styles.check}>
            <input id="filter-clean" type="checkbox" checked={state.hideClean} onChange={(e) => update({ hideClean: e.target.checked })} />
            Hide clean records
          </label>
        ) : null}
        {active ? (
          <button type="button" className={styles.reset} onClick={reset}>
            Clear filters
          </button>
        ) : null}
      </div>
      <div className={styles.chips} aria-label="Category filters">
        <span className={styles.chipLabel}>Charge</span>
        {CATEGORIES.filter((c) => categoryCounts[c] > 0 || state.categories.has(c)).map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.chip} ${state.categories.has(c) ? styles.chipOn : ''}`}
            onClick={() => update({ categories: toggleIn(state.categories, c) })}
            aria-pressed={state.categories.has(c)}
          >
            {CATEGORY_LABELS[c]} <span className="mono">{categoryCounts[c]}</span>
          </button>
        ))}
      </div>
      <div className={styles.chips} aria-label="Provider filters">
        <span className={styles.chipLabel}>Provider</span>
        {implicated.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.chip} ${state.providerIds.has(p.id) ? styles.chipOn : ''}`}
            onClick={() => update({ providerIds: toggleIn(state.providerIds, p.id) })}
            aria-pressed={state.providerIds.has(p.id)}
          >
            {p.name} <span className="mono">{providerCounts.get(p.id) ?? 0}</span>
          </button>
        ))}
        {implicated.length === 0 ? <span className={styles.empty}>no provider has an incident on record</span> : null}
      </div>
    </div>
  )
}
