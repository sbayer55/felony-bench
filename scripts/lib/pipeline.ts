import { IncidentBodySchema, type Incident, type IncidentBody, type Model, type Provider } from '../../src/data/schema.ts'
import { findDuplicate } from './dedupe.ts'

export interface CandidateModel {
  id: string
  name: string
  providerId: string
}

export interface Rejection {
  title: string
  reason: string
}

export interface PipelineInput {
  candidates: unknown[]
  candidateModels: CandidateModel[]
  providers: Provider[]
  models: Model[]
  existing: Incident[]
  max: number
  since?: string
  /** Returns true when every source URL resolves. Injected so tests stay offline. */
  sourcesReachable: (urls: string[]) => Promise<boolean>
}

export interface PipelineOutput {
  accepted: Incident[]
  newModels: Model[]
  rejected: Rejection[]
}

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugify(s: string, max = 48): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(new RegExp(`^(.{1,${max}})(?:-.*)?$`), '$1')
}

export function makeId(body: IncidentBody, taken: Set<string>): string {
  const base = `${body.date}-${slugify(body.title)}`
  let id = base
  for (let k = 2; taken.has(id); k++) id = `${base}-${k}`
  return id
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const providerIds = new Set(input.providers.map((p) => p.id))
  const models = [...input.models]
  const modelById = new Map(models.map((m) => [m.id, m]))
  const newModels: Model[] = []
  const rejected: Rejection[] = []
  const accepted: Incident[] = []
  const existing = [...input.existing]
  const taken = new Set(existing.map((i) => i.id))

  // Roster additions first, so candidates can reference them.
  for (const cm of input.candidateModels) {
    if (!slugRe.test(cm.id) || !cm.name || !providerIds.has(cm.providerId)) continue
    if (modelById.has(cm.id)) continue
    const m: Model = { id: cm.id, name: cm.name, providerId: cm.providerId }
    models.push(m)
    modelById.set(m.id, m)
    newModels.push(m)
  }

  for (const raw of input.candidates) {
    const title = typeof raw === 'object' && raw && 'title' in raw ? String((raw as { title: unknown }).title) : '(untitled)'
    if (accepted.length >= input.max) {
      rejected.push({ title, reason: `over cap of ${input.max} per run` })
      continue
    }
    const parsed = IncidentBodySchema.safeParse(raw)
    if (!parsed.success) {
      rejected.push({ title, reason: `schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` })
      continue
    }
    const body = parsed.data
    if (input.since && body.date < input.since) {
      rejected.push({ title, reason: `dated ${body.date}, before --since ${input.since}` })
      continue
    }
    if (body.date > new Date().toISOString().slice(0, 10)) {
      rejected.push({ title, reason: `dated in the future (${body.date})` })
      continue
    }
    const unknownProviders = body.providerIds.filter((p) => !providerIds.has(p))
    if (unknownProviders.length) {
      rejected.push({ title, reason: `unknown provider(s): ${unknownProviders.join(', ')}` })
      continue
    }
    // Unknown models are dropped; the incident survives at provider level.
    const keptModels = body.modelIds.filter((m) => modelById.has(m))
    const providerSet = new Set(body.providerIds)
    for (const m of keptModels) providerSet.add(modelById.get(m)!.providerId)
    const normalized: IncidentBody = { ...body, modelIds: keptModels, providerIds: [...providerSet] }

    const dupe = findDuplicate(normalized, existing)
    if (dupe) {
      rejected.push({ title, reason: `duplicate of ${dupe.existingId} (${dupe.reason})` })
      continue
    }
    const reachable = await input.sourcesReachable(normalized.sources.map((s) => s.url))
    if (!reachable) {
      rejected.push({ title, reason: 'a source URL did not resolve' })
      continue
    }
    const id = makeId(normalized, taken)
    taken.add(id)
    const incident: Incident = { id, ...normalized }
    accepted.push(incident)
    existing.push(incident) // so later candidates in the same batch dedupe against it
  }

  // Only keep roster additions that something actually references.
  const referenced = new Set(accepted.flatMap((i) => i.modelIds))
  return { accepted, newModels: newModels.filter((m) => referenced.has(m.id)), rejected }
}
