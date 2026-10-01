import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Incident, Meta, Model, Provider } from './schema'
import { apiFetch, errorMessage } from '../lib/api'

export type Bootstrap = { providers: Provider[]; models: Model[]; incidents: Incident[]; meta: Meta }

export type Data = Bootstrap & {
  providerById: Map<string, Provider>
  modelById: Map<string, Model>
  incidentById: Map<string, Incident>
  /** Refetch /api/bootstrap. Data already on screen stays visible while it loads. */
  reload: () => Promise<void>
}

type Raw = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: Bootstrap }

export type DataStatus = { state: 'loading' } | { state: 'error'; message: string; reload: () => Promise<void> } | { state: 'ready'; data: Data }

const DataContext = createContext<DataStatus | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<Raw>({ state: 'loading' })

  // `cache` is 'no-cache' on reload: the browser revalidates with the ETag (a cheap 304 when nothing changed) instead
  // of reusing a copy that may predate an approval.
  const load = useCallback(async (signal?: AbortSignal, cache?: RequestCache) => {
    try {
      const data = await apiFetch<Bootstrap>('/api/bootstrap', { signal, cache })
      setRaw({ state: 'ready', data })
    } catch (err) {
      if (signal?.aborted) return
      // A failed background reload keeps whatever is already on screen.
      setRaw((prev) => (prev.state === 'ready' ? prev : { state: 'error', message: errorMessage(err) }))
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  const reload = useCallback(async () => {
    setRaw((prev) => (prev.state === 'ready' ? prev : { state: 'loading' }))
    await load(undefined, 'no-cache')
  }, [load])

  const value = useMemo<DataStatus>(() => {
    if (raw.state === 'loading') return raw
    if (raw.state === 'error') return { ...raw, reload }
    const d = raw.data
    return {
      state: 'ready',
      data: {
        ...d,
        providerById: new Map(d.providers.map((p) => [p.id, p])),
        modelById: new Map(d.models.map((m) => [m.id, m])),
        incidentById: new Map(d.incidents.map((i) => [i.id, i])),
        reload,
      },
    }
  }, [raw, reload])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

/** Load state, for components that render before the data arrives (the gate, the footer). */
export function useDataStatus(): DataStatus {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useDataStatus must be used inside <DataProvider>')
  return ctx
}

/** The public dataset. Only call below <DataGate>, which waits for it. */
export function useData(): Data {
  const status = useDataStatus()
  if (status.state !== 'ready') throw new Error('useData called before the data loaded; render it inside <DataGate>')
  return status.data
}
