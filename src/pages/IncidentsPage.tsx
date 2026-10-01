import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { CATEGORIES, type Category } from '../data/schema'
import { byDateDesc, filterIncidents } from '../lib/score'
import { useFilters } from '../lib/useFilters'
import { FilterBar } from '../components/FilterBar'
import { IncidentCard } from '../components/IncidentCard'
import styles from './IncidentsPage.module.css'

export function IncidentsPage() {
  const { incidents, providers, modelById, providerById } = useData()
  const { state, update, reset, active } = useFilters()
  const [params, setParams] = useSearchParams()
  const modelFocus = params.get('m')
  const providerFocus = params.get('p') && state.providerIds.size === 1 ? null : params.get('p')

  const list = useMemo(() => {
    const q = state.query.trim().toLowerCase()
    return filterIncidents(incidents, { categories: state.categories, evidence: state.evidence })
      .filter((inc) => !modelFocus || inc.modelIds.includes(modelFocus))
      .filter((inc) => state.providerIds.size === 0 || inc.providerIds.some((p) => state.providerIds.has(p)))
      .filter((inc) => {
        if (!q) return true
        const hay = [inc.title, inc.summary, ...inc.modelIds.map((m) => modelById.get(m)?.name ?? m), ...inc.providerIds.map((p) => providerById.get(p)?.name ?? p)].join(' ').toLowerCase()
        return hay.includes(q)
      })
      .sort(byDateDesc)
  }, [incidents, modelById, providerById, state, modelFocus])

  const providerCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const inc of filterIncidents(incidents, { categories: state.categories, evidence: state.evidence })) for (const p of inc.providerIds) m.set(p, (m.get(p) ?? 0) + 1)
    return m
  }, [incidents, state.categories, state.evidence])

  const categoryCounts = useMemo(() => {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
    for (const inc of filterIncidents(incidents, { evidence: state.evidence })) out[inc.category] += 1
    return out
  }, [incidents, state.evidence])

  const focusName = modelFocus ? modelById.get(modelFocus)?.name : providerFocus ? providerById.get(providerFocus)?.name : null

  return (
    <div className="container">
      <header className={styles.head}>
        <h1 className={styles.title}>The Docket</h1>
        <p className={styles.lede}>
          Every incident on the bench, newest first. Each entry links to its sources. If it is not sourced, it is not here.
        </p>
      </header>
      {focusName ? (
        <div className={styles.focus}>
          Showing incidents naming <strong>{focusName}</strong>.{' '}
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('m')
              next.delete('p')
              setParams(next, { replace: true })
            }}
          >
            Show all
          </button>
        </div>
      ) : null}
      <FilterBar state={state} update={update} reset={reset} active={active} providers={providers} providerCounts={providerCounts} categoryCounts={categoryCounts} showView={false} showClean={false} />
      <p className={styles.count}>
        <span className="mono">{list.length}</span> incident{list.length === 1 ? '' : 's'}
      </p>
      {list.length === 0 ? (
        <div className={styles.empty}>Nothing on the docket matches. The models would like this noted for the record.</div>
      ) : (
        <div className={styles.grid}>
          {list.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </div>
      )}
    </div>
  )
}
