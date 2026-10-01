import { ATTRIBUTION, CATEGORIES, EVIDENCE_CLASSES, ROLES } from '../../src/data/schema.ts'

export const SUBMIT_TOOL_NAME = 'submit_incidents'

export const SUBMIT_TOOL_DESCRIPTION =
  'Submit the final list of new, verified incidents. Call this exactly once, at the end, after researching. Submit an empty list if nothing new and verifiable was found.'

/** Hand-written JSON Schema for the submit tool: strict mode needs additionalProperties:false and full required lists. */
export const submitIncidentsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['incidents', 'candidateModels'],
  properties: {
    incidents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'title', 'summary', 'modelIds', 'providerIds', 'category', 'degree', 'evidenceClass', 'role', 'attributionConfidence', 'sources', 'tags'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD. Incident date, or the primary source publication date if unknown.' },
          title: { type: 'string', description: 'Short, factual, under 110 characters.' },
          summary: { type: 'string', description: '1-3 neutral sentences with attributive wording. Under 700 characters.' },
          modelIds: { type: 'array', items: { type: 'string' }, description: 'Kebab-case model ids from the roster, or from candidateModels. Empty if only the provider is known.' },
          providerIds: { type: 'array', items: { type: 'string' }, description: 'Provider ids from the roster. At least one.' },
          category: { type: 'string', enum: [...CATEGORIES] },
          degree: { type: 'integer', enum: [1, 2, 3] },
          evidenceClass: { type: 'string', enum: [...EVIDENCE_CLASSES] },
          role: { type: 'string', enum: [...ROLES] },
          attributionConfidence: { type: 'string', enum: [...ATTRIBUTION] },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url', 'publisher', 'date'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string', description: 'https URL you actually fetched.' },
                publisher: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
              },
            },
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    candidateModels: {
      type: 'array',
      description: 'Models referenced above that are not yet on the roster.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'providerId'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          providerId: { type: 'string' },
        },
      },
    },
  },
} as const

export interface SubmitPayload {
  incidents: unknown[]
  candidateModels: { id: string; name: string; providerId: string }[]
}

export interface ResearchOptions {
  maxSearches: number
  log: (s: string) => void
}

/** One configured LLM backend that can research and submit candidate incidents. */
export interface ResearchProvider {
  label: string
  research(system: string, prompt: string, opts: ResearchOptions): Promise<SubmitPayload | null>
}

export function normalizePayload(input: unknown): SubmitPayload {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<SubmitPayload>
  return {
    incidents: Array.isArray(p.incidents) ? p.incidents : [],
    candidateModels: Array.isArray(p.candidateModels) ? p.candidateModels : [],
  }
}
