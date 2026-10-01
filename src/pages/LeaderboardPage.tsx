import { useMemo } from 'react'
import { useData } from '../data/DataProvider'
import { CATEGORIES, type Category } from '../data/schema'
import { computeStats, filterIncidents, filterRows, scoreModels, scoreProviders } from '../lib/score'
import { useFilters } from '../lib/useFilters'
import { HeroStats } from '../components/HeroStats'
import { FilterBar } from '../components/FilterBar'
import { Leaderboard } from '../components/Leaderboard'
import { IncidentsOverTime } from '../components/charts/IncidentsOverTime'
import { CategoryByProvider } from '../components/charts/CategoryByProvider'
import styles from './LeaderboardPage.module.css'

export function LeaderboardPage() {
  const { incidents, models, providers } = useData()
  const { state, update, reset, active } = useFilters()

  const scoped = useMemo(() => filterIncidents(incidents, { categories: state.categories, evidence: state.evidence }), [incidents, state.categories, state.evidence])

  const allModelRows = useMemo(() => scoreModels(models, providers, scoped), [models, providers, scoped])
  const allProviderRows = useMemo(() => scoreProviders(providers, scoped), [providers, scoped])
  const rankSource = state.view === 'models' ? allModelRows : allProviderRows

  const rows = useMemo(
    () => filterRows(rankSource, { query: state.query, providerIds: state.providerIds, hideClean: state.hideClean }),
    [rankSource, state.query, state.providerIds, state.hideClean],
  )

  const stats = useMemo(() => computeStats(scoped, allModelRows), [scoped, allModelRows])

  const providerCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const inc of scoped) for (const p of inc.providerIds) m.set(p, (m.get(p) ?? 0) + 1)
    return m
  }, [scoped])

  const categoryCounts = useMemo(() => {
    const base = filterIncidents(incidents, { evidence: state.evidence })
    const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
    for (const inc of base) out[inc.category] += 1
    return out
  }, [incidents, state.evidence])

  const scopeLabel = [
    state.evidence === 'all' ? 'all evidence classes' : state.evidence === 'production' ? 'incidents outside the lab' : 'lab evaluations only',
    state.categories.size ? `${state.categories.size} charge type${state.categories.size === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="container">
      <HeroStats stats={stats} totalModels={models.length} scope={scopeLabel} />
      <FilterBar state={state} update={update} reset={reset} active={active} providers={providers} providerCounts={providerCounts} categoryCounts={categoryCounts} />
      <Leaderboard rows={rows} rankSource={rankSource} activeCategories={state.categories} />
      <section className={styles.charts} aria-label="Charts">
        <IncidentsOverTime incidents={scoped} />
        <CategoryByProvider incidents={scoped} providers={providers} />
      </section>
    </div>
  )
}
