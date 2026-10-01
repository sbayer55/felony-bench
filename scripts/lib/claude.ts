import Anthropic from '@anthropic-ai/sdk'
import { SUBMIT_TOOL_DESCRIPTION, SUBMIT_TOOL_NAME, normalizePayload, submitIncidentsSchema, type ResearchOptions, type ResearchProvider, type SubmitPayload } from './research.ts'

export const MODEL = 'claude-opus-5-5'

export const submitIncidentsTool: Anthropic.Beta.BetaTool = {
  name: SUBMIT_TOOL_NAME,
  description: SUBMIT_TOOL_DESCRIPTION,
  strict: true,
  input_schema: submitIncidentsSchema as unknown as Anthropic.Beta.BetaTool['input_schema'],
}

export function serverTools(maxUses: number): Anthropic.Beta.BetaToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxUses },
  ]
}

export function anthropicProvider(opts: { label?: string; model?: string; apiKey: string }): ResearchProvider {
  const model = opts.model ?? MODEL
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 })
  return {
    label: opts.label ?? `anthropic(${model})`,
    research: (system, prompt, ro) => research(client, model, system, prompt, ro),
  }
}

/**
 * Run one research turn. Lets the model search and fetch (server tools), and returns the payload it
 * hands to submit_incidents, or null if it ended without submitting.
 */
export async function research(client: Anthropic, model: string, system: string, prompt: string, opts: ResearchOptions): Promise<SubmitPayload | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  const tools: Anthropic.Beta.BetaToolUnion[] = [...serverTools(opts.maxSearches), submitIncidentsTool]

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model,
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
      if (submit) return normalizePayload(submit.input)
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
