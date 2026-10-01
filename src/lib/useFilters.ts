import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATEGORIES, type Category } from '../data/schema'
import type { EvidenceFilter } from './score'

export interface FilterState {
  query: string
  providerIds: Set<string>
  categories: Set<Category>
  evidence: EvidenceFilter
  hideClean: boolean
  view: 'models' | 'providers'
}

const isCategory = (s: string): s is Category => (CATEGORIES as readonly string[]).includes(s)

export function useFilters() {
  const [params, setParams] = useSearchParams()

  const state = useMemo<FilterState>(() => {
    const ev = params.get('ev')
    const view = params.get('view')
    return {
      query: params.get('q') ?? '',
      providerIds: new Set(params.getAll('p')),
      categories: new Set(params.getAll('c').filter(isCategory)),
      evidence: ev === 'production' || ev === 'evaluation' ? ev : 'all',
      hideClean: params.get('clean') === '0',
      view: view === 'providers' ? 'providers' : 'models',
    }
  }, [params])

  const update = useCallback(
    (patch: Partial<FilterState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const s = { ...state, ...patch }
          next.delete('q')
          if (s.query) next.set('q', s.query)
          next.delete('p')
          for (const p of s.providerIds) next.append('p', p)
          next.delete('c')
          for (const c of s.categories) next.append('c', c)
          next.delete('ev')
          if (s.evidence !== 'all') next.set('ev', s.evidence)
          next.delete('clean')
          if (s.hideClean) next.set('clean', '0')
          next.delete('view')
          if (s.view !== 'models') next.set('view', s.view)
          return next
        },
        { replace: true },
      )
    },
    [setParams, state],
  )

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])

  const active =
    state.query.length > 0 || state.providerIds.size > 0 || state.categories.size > 0 || state.evidence !== 'all' || state.hideClean

  return { state, update, reset, active }
}
