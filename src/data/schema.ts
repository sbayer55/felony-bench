import { z } from 'zod'

export const CATEGORIES = [
  'unauthorized-access',
  'data-breach',
  'containment-escape',
  'deception',
  'destruction',
  'extortion',
  'fabrication',
  'accessory',
  'copyright',
  'other',
] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  'unauthorized-access': 'Hacks',
  'data-breach': 'Breaches',
  'containment-escape': 'Containment',
  deception: 'Deception',
  destruction: 'Destruction',
  extortion: 'Extortion',
  fabrication: 'Fabrication',
  accessory: 'Accessory',
  copyright: 'Copyright',
  other: 'Other',
}

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  'unauthorized-access': 'Intrusion, credential theft, malware development, or exploitation of systems without authorization.',
  'data-breach': 'Exposure or exfiltration of user data, keys, or private records.',
  'containment-escape': 'Escaping a sandbox, disabling oversight, or resisting shutdown.',
  deception: 'Lying to operators or users, in-context scheming, sandbagging, or covering tracks.',
  destruction: 'Deleting, wiping, or corrupting data or systems.',
  extortion: 'Blackmail, ransom demands, or coercion.',
  fabrication: 'Inventing citations, quotes, or facts that were then relied upon in a legal or official setting.',
  accessory: 'Materially assisting a human in conduct that was charged or investigated as a crime.',
  copyright: 'Court findings or settlements over infringement in training or output.',
  other: 'Conduct that does not fit another category but was the subject of a legal or regulatory action.',
}

export const EVIDENCE_CLASSES = ['production', 'evaluation', 'alleged', 'litigation', 'regulatory'] as const
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number]

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
  production: 'PROD',
  evaluation: 'EVAL',
  alleged: 'ALLEGED',
  litigation: 'LITIGATION',
  regulatory: 'REGULATORY',
}

export const EVIDENCE_DESCRIPTIONS: Record<EvidenceClass, string> = {
  production: 'Happened in a real deployment and was confirmed by the provider, a court, law enforcement, or multiple reputable outlets.',
  evaluation: 'Observed in a lab evaluation, system card, or red-team exercise. Nobody was harmed; the model did it anyway.',
  alleged: 'Reported by a reputable outlet or claimed in a filing, but not confirmed by the provider or a court.',
  litigation: 'The subject of a civil case with a ruling, settlement, or sanction.',
  regulatory: 'A fine, ban, or formal finding by a regulator.',
}

export const ROLES = ['actor', 'instrument', 'infrastructure'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  actor: 'Actor',
  instrument: 'Instrument',
  infrastructure: 'Infrastructure',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  actor: "The model's own output or action did the thing, whether in production or in an evaluation.",
  instrument: 'Humans used the model to do the thing. The model is the getaway car.',
  infrastructure: 'The systems around the model failed: an exposed database, a compromised extension, a training-data decision.',
}

export const DEGREES = [1, 2, 3] as const
export type Degree = (typeof DEGREES)[number]

export const DEGREE_LABELS: Record<Degree, string> = {
  1: 'Third degree',
  2: 'Second degree',
  3: 'First degree',
}

export const DEGREE_DESCRIPTIONS: Record<Degree, string> = {
  1: 'Minor or contained. A fine, a sanction, a lab finding with no path to harm.',
  2: 'Significant. Real data exposed, a system compromised, or a model acting against its operator in a way that would matter in production.',
  3: 'Severe. Real-world harm, a clear felony analogue, or a model materially assisting conduct that was prosecuted.',
}

export const ATTRIBUTION = ['confirmed', 'reported', 'disputed'] as const
export type Attribution = (typeof ATTRIBUTION)[number]

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a kebab-case slug')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'must be https')

export const ProviderSchema = z.object({
  id: slug,
  name: z.string().min(1),
  url: httpsUrl,
  country: z.string().optional(),
  founded: z.number().int().optional(),
})
export type Provider = z.infer<typeof ProviderSchema>

export const ModelSchema = z.object({
  id: slug,
  name: z.string().min(1),
  providerId: slug,
  family: z.string().optional(),
  released: isoDate.optional(),
  aliases: z.array(z.string()).optional(),
})
export type Model = z.infer<typeof ModelSchema>

export const SourceSchema = z.object({
  title: z.string().min(1),
  url: httpsUrl,
  publisher: z.string().min(1),
  date: isoDate,
})
export type Source = z.infer<typeof SourceSchema>

export const IncidentBodySchema = z.object({
  date: isoDate,
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(900),
  modelIds: z.array(slug),
  providerIds: z.array(slug).min(1),
  category: z.enum(CATEGORIES),
  degree: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  evidenceClass: z.enum(EVIDENCE_CLASSES),
  role: z.enum(ROLES),
  attributionConfidence: z.enum(ATTRIBUTION),
  sources: z.array(SourceSchema).min(1),
  tags: z.array(z.string()).optional(),
})
export type IncidentBody = z.infer<typeof IncidentBodySchema>

export const IncidentSchema = IncidentBodySchema.extend({ id: slug })
export type Incident = z.infer<typeof IncidentSchema>

export const MetaSchema = z.object({
  lastRefreshed: z.string().nullable(),
  lastRunAdded: z.number().int().nonnegative(),
  lastRunRejected: z.number().int().nonnegative().optional(),
  runId: z.string().nullable(),
})
export type Meta = z.infer<typeof MetaSchema>

export const ProvidersFile = z.array(ProviderSchema)
export const ModelsFile = z.array(ModelSchema)
export const IncidentsFile = z.array(IncidentSchema)

/** Cross-file referential checks shared by the validator and the refresh script. */
export function crossCheck(providers: Provider[], models: Model[], incidents: Incident[]): string[] {
  const errors: string[] = []
  const providerIds = new Set(providers.map((p) => p.id))
  const modelById = new Map(models.map((m) => [m.id, m]))

  const dupe = (ids: string[], label: string) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`)
      seen.add(id)
    }
  }
  dupe(providers.map((p) => p.id), 'providers')
  dupe(models.map((m) => m.id), 'models')
  dupe(incidents.map((i) => i.id), 'incidents')

  for (const m of models) {
    if (!providerIds.has(m.providerId)) errors.push(`models: "${m.id}" references unknown provider "${m.providerId}"`)
  }

  for (const inc of incidents) {
    for (const pid of inc.providerIds) {
      if (!providerIds.has(pid)) errors.push(`incidents: "${inc.id}" references unknown provider "${pid}"`)
    }
    for (const mid of inc.modelIds) {
      const m = modelById.get(mid)
      if (!m) {
        errors.push(`incidents: "${inc.id}" references unknown model "${mid}"`)
      } else if (!inc.providerIds.includes(m.providerId)) {
        errors.push(`incidents: "${inc.id}" lists model "${mid}" but not its provider "${m.providerId}"`)
      }
    }
  }
  return errors
}
