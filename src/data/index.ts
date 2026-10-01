import type { Incident, Meta, Model, Provider } from './schema'
import providersJson from './providers.json'
import modelsJson from './models.json'
import incidentsJson from './incidents.json'
import metaJson from './meta.json'

export const providers = providersJson as Provider[]
export const models = modelsJson as Model[]
export const incidents = incidentsJson as Incident[]
export const meta = metaJson as Meta

export const providerById = new Map(providers.map((p) => [p.id, p]))
export const modelById = new Map(models.map((m) => [m.id, m]))
export const incidentById = new Map(incidents.map((i) => [i.id, i]))

export const REPO_URL = 'https://github.com/sbayer55/felony-bench'
export const ACTIONS_URL = `${REPO_URL}/actions/workflows/refresh.yml`
