import Anthropic from '@anthropic-ai/sdk'
import { ATTRIBUTION, CATEGORIES, EVIDENCE_CLASSES, ROLES } from '../../src/data/schema.ts'

export const MODEL = 'claude-opus-5-5'

export const SUBMIT_TOOL_NAME = 'submit_incidents'

/** Hand-written JSON Schema for the submit tool: strict mode needs additionalProperties:false and full required lists. */
export const submitIncidentsTool: Anthropic.Beta.BetaTool = {
  name: SUBMIT_TOOL_NAME,
  description:
    'Submit the final list of new, verified incidents. Call this exactly once, at the end, after researching. Submit an empty list if nothing new and verifiable was found.',
  strict: true,
  input_schema: {
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
  },
}

export function serverTools(maxUses: number): Anthropic.Beta.BetaToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxUses },
  ]
}

export function makeClient(): Anthropic {
  if (process.env.GITHUB_ACTIONS && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it as a repository secret.')
  }
  return new Anthropic({ maxRetries: 3 })
}

export interface SubmitPayload {
  incidents: unknown[]
  candidateModels: { id: string; name: string; providerId: string }[]
}

/**
 * Run one research turn. Lets the model search and fetch (server tools), and returns the payload it
 * hands to submit_incidents, or null if it ended without submitting.
 */
export async function research(client: Anthropic, system: string, prompt: string, opts: { maxSearches: number; log: (s: string) => void }): Promise<SubmitPayload | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  const tools: Anthropic.Beta.BetaToolUnion[] = [...serverTools(opts.maxSearches), submitIncidentsTool]

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages,
      tools,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })

    const searches = response.content.filter((b) => b.type === 'server_tool_use').length
    opts.log(`turn ${turn + 1}: stop=${response.stop_reason} server_tool_uses=${searches} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`)

    if (response.stop_reason === 'refusal') {
      opts.log(`refusal: ${response.stop_details?.category ?? 'unknown'} ${response.stop_details?.explanation ?? ''}`)
      return null
    }

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      const submit = toolUses.find((t) => t.name === SUBMIT_TOOL_NAME)
      if (submit) {
        const payload = submit.input as SubmitPayload
        return {
          incidents: Array.isArray(payload.incidents) ? payload.incidents : [],
          candidateModels: Array.isArray(payload.candidateModels) ? payload.candidateModels : [],
        }
      }
      // Unknown client tool call: answer so the loop can continue.
      messages.push({
        role: 'user',
        content: toolUses.map((t) => ({ type: 'tool_result' as const, tool_use_id: t.id, content: 'Unknown tool.', is_error: true })),
      })
      continue
    }

    if (response.stop_reason === 'pause_turn') {
      continue
    }

    if (response.stop_reason === 'max_tokens') {
      opts.log('hit max_tokens before submitting; asking the model to submit now')
      messages.push({ role: 'user', content: `Stop researching and call ${SUBMIT_TOOL_NAME} now with what you have verified.` })
      continue
    }

    // end_turn without a submission: nudge once, then give up.
    if (turn === 0) {
      messages.push({ role: 'user', content: `You must call ${SUBMIT_TOOL_NAME} to finish, even with an empty list.` })
      continue
    }
    return null
  }
  return null
}
