import { useMemo } from 'react'
import { useData } from '../data/DataProvider'
import { CATEGORIES, type Category } from '../data/schema'
import { filterIncidents } from '../lib/score'
import { useFilters } from '../lib/useFilters'
import { FilterBar } from '../components/FilterBar'
import { DocketTimeline } from '../components/charts/DocketTimeline'
import { ScoreRace } from '../components/charts/ScoreRace'
import { MostWanted } from '../components/charts/MostWanted'
import { ChargeMatrix } from '../components/charts/ChargeMatrix'
import { providerColors } from '../components/charts/theme'
import styles from './ExhibitsPage.module.css'

export function ExhibitsPage() {
  const { incidents, models, providers, modelById, providerById } = useData()
  const { state, update, reset, active } = useFilters()

  const byCharge = useMemo(() => filterIncidents(incidents, { categories: state.categories, evidence: state.evidence }), [incidents, state.categories, state.evidence])

  // Same scoping as the docket: provider chips and the search box narrow incidents, not rows.
  const scoped = useMemo(() => {
    const q = state.query.trim().toLowerCase()
    return byCharge
      .filter((inc) => state.providerIds.size === 0 || inc.providerIds.some((p) => state.providerIds.has(p)))
      .filter((inc) => {
        if (!q) return true
        const hay = [inc.title, inc.summary, ...inc.modelIds.map((m) => modelById.get(m)?.name ?? m), ...inc.providerIds.map((p) => providerById.get(p)?.name ?? p)].join(' ').toLowerCase()
        return hay.includes(q)
      })
  }, [byCharge, state.providerIds, state.query, modelById, providerById])

  const colors = useMemo(() => providerColors(providers, incidents), [providers, incidents])

  const providerCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const inc of byCharge) for (const p of inc.providerIds) m.set(p, (m.get(p) ?? 0) + 1)
    return m
  }, [byCharge])

  const categoryCounts = useMemo(() => {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
    for (const inc of filterIncidents(incidents, { evidence: state.evidence })) out[inc.category] += 1
    return out
  }, [incidents, state.evidence])

  return (
    <div className="container">
      <header className={styles.head}>
        <h1 className={styles.title}>Exhibits</h1>
        <p className={styles.lede}>
          The evidence, entered into the record as charts. Every filter applies to every exhibit, every mark links back to the docket, and every chart has a
          table underneath if you would rather read the numbers.
        </p>
      </header>
      <FilterBar state={state} update={update} reset={reset} active={active} providers={providers} providerCounts={providerCounts} categoryCounts={categoryCounts} showView={false} showClean={false} />
      <p className={styles.scope}>
        <span className="mono">{scoped.length}</span> of <span className="mono">{incidents.length}</span> incidents in scope
      </p>
      <div className={styles.grid}>
        <div className={styles.wide}>
          <DocketTimeline incidents={scoped} />
        </div>
        <ScoreRace incidents={scoped} providers={providers} colors={colors} only={state.providerIds} />
        <MostWanted incidents={scoped} models={models} providers={providers} />
        <div className={styles.wide}>
          <ChargeMatrix incidents={scoped} providers={providers} evidence={state.evidence} />
        </div>
      </div>
    </div>
  )
}
