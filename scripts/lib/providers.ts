/**
 * Picks research providers from whatever credentials and config are present in the environment.
 *
 *   anthropic  ANTHROPIC_API_KEY                 (ANTHROPIC_MODEL)
 *   ollama     OLLAMA_MODEL                      (OLLAMA_BASE_URL, OLLAMA_API_KEY)
 *   bifrost    BIFROST_MODEL                     (BIFROST_BASE_URL, BIFROST_API_KEY)
 *   9router    NINEROUTER_MODEL                  (NINEROUTER_BASE_URL, NINEROUTER_API_KEY)
 *
 * The gateways need a client-side search backend: BRAVE_API_KEY, SEARXNG_URL, or OLLAMA_API_KEY
 * (or force one with SEARCH_BACKEND). REFRESH_PROVIDERS / --providers= overrides detection.
 */
import { MODEL as ANTHROPIC_DEFAULT_MODEL, anthropicProvider } from './claude.ts'
import { openAICompatProvider } from './openai-compat.ts'
import type { ResearchProvider } from './research.ts'
import { makeWebTools, type SearchBackendName, type SearchConfig } from './web-tools.ts'

export type ProviderName = 'anthropic' | 'ollama' | 'bifrost' | '9router'

export interface ProviderSpec {
  name: ProviderName
  model: string
  apiKey?: string
  /** OpenAI-compatible base URL; undefined for anthropic (SDK default). */
  baseUrl?: string
}

export interface Detection {
  providers: ProviderSpec[]
  search?: SearchConfig
  warnings: string[]
}

type Env = Record<string, string | undefined>

interface Gateway {
  prefix: string
  defaultBaseUrl: string
}

const GATEWAYS: Record<Exclude<ProviderName, 'anthropic'>, Gateway> = {
  ollama: { prefix: 'OLLAMA', defaultBaseUrl: 'http://localhost:11434/v1' },
  bifrost: { prefix: 'BIFROST', defaultBaseUrl: 'http://localhost:8080/v1' },
  '9router': { prefix: 'NINEROUTER', defaultBaseUrl: 'http://localhost:20128/v1' },
}

export const PROVIDER_NAMES: ProviderName[] = ['anthropic', 'ollama', 'bifrost', '9router']

export const SETUP_HELP = `Configure at least one provider:
  anthropic  ANTHROPIC_API_KEY  (optional ANTHROPIC_MODEL)
  ollama     OLLAMA_MODEL       (optional OLLAMA_BASE_URL, OLLAMA_API_KEY)
  bifrost    BIFROST_MODEL      (optional BIFROST_BASE_URL, BIFROST_API_KEY)
  9router    NINEROUTER_MODEL   (optional NINEROUTER_BASE_URL, NINEROUTER_API_KEY)
Ollama, Bifrost and 9router also need a search backend: BRAVE_API_KEY, SEARXNG_URL, or OLLAMA_API_KEY.`

/** Empty strings count as unset (GitHub Actions passes missing secrets/vars as ""). */
function get(env: Env, key: string): string | undefined {
  const v = env[key]?.trim()
  return v ? v : undefined
}

function isProviderName(s: string): s is ProviderName {
  return (PROVIDER_NAMES as string[]).includes(s)
}

export function detectSearch(env: Env): SearchConfig | undefined {
  const forced = get(env, 'SEARCH_BACKEND')
  const configs: Record<SearchBackendName, SearchConfig | undefined> = {
    brave: get(env, 'BRAVE_API_KEY') ? { backend: 'brave', apiKey: get(env, 'BRAVE_API_KEY') } : undefined,
    searxng: get(env, 'SEARXNG_URL') ? { backend: 'searxng', url: get(env, 'SEARXNG_URL') } : undefined,
    ollama: get(env, 'OLLAMA_API_KEY') ? { backend: 'ollama', apiKey: get(env, 'OLLAMA_API_KEY') } : undefined,
  }
  if (forced) {
    if (!(forced in configs)) throw new Error(`SEARCH_BACKEND=${forced} is not one of: ${Object.keys(configs).join(', ')}`)
    const cfg = configs[forced as SearchBackendName]
    if (!cfg) throw new Error(`SEARCH_BACKEND=${forced} but ${forced === 'brave' ? 'BRAVE_API_KEY' : forced === 'searxng' ? 'SEARXNG_URL' : 'OLLAMA_API_KEY'} is not set`)
    return cfg
  }
  return configs.brave ?? configs.searxng ?? configs.ollama
}

/** Build a spec from env, with an optional model override. Returns a reason string when not configured. */
function specFor(name: ProviderName, env: Env, modelOverride?: string): ProviderSpec | string {
  if (name === 'anthropic') {
    const apiKey = get(env, 'ANTHROPIC_API_KEY')
    if (!apiKey) return 'ANTHROPIC_API_KEY is not set'
    return { name, apiKey, model: modelOverride ?? get(env, 'ANTHROPIC_MODEL') ?? ANTHROPIC_DEFAULT_MODEL }
  }
  const g = GATEWAYS[name]
  const model = modelOverride ?? get(env, `${g.prefix}_MODEL`)
  if (!model) return `${g.prefix}_MODEL is not set`
  return { name, model, baseUrl: get(env, `${g.prefix}_BASE_URL`) ?? g.defaultBaseUrl, apiKey: get(env, `${g.prefix}_API_KEY`) }
}

/**
 * Without an override, enable every provider whose config is present. With an override
 * ("anthropic,ollama:qwen3:32b"), use exactly that list and fail on anything unconfigured.
 */
export function detectProviders(env: Env, override?: string): Detection {
  const warnings: string[] = []
  const search = detectSearch(env)
  const list = override?.trim() || get(env, 'REFRESH_PROVIDERS')
  const providers: ProviderSpec[] = []

  if (list) {
    const errors: string[] = []
    for (const entry of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const colon = entry.indexOf(':')
      const name = colon === -1 ? entry : entry.slice(0, colon)
      const model = colon === -1 ? undefined : entry.slice(colon + 1) || undefined
      if (!isProviderName(name)) {
        errors.push(`unknown provider "${name}" (valid: ${PROVIDER_NAMES.join(', ')})`)
        continue
      }
      const spec = specFor(name, env, model)
      if (typeof spec === 'string') errors.push(`${name}: ${spec}`)
      else if (name !== 'anthropic' && !search) errors.push(`${name}: no search backend (set BRAVE_API_KEY, SEARXNG_URL, or OLLAMA_API_KEY)`)
      else providers.push(spec)
    }
    if (errors.length) throw new Error(`Provider configuration errors:\n  ${errors.join('\n  ')}`)
    if (!providers.length) throw new Error(`No providers in "${list}".\n${SETUP_HELP}`)
    return { providers, search, warnings }
  }

  for (const name of PROVIDER_NAMES) {
    const spec = specFor(name, env)
    if (typeof spec === 'string') {
      if (name !== 'anthropic') {
        const { prefix } = GATEWAYS[name]
        // Partial config is probably a mistake; OLLAMA_API_KEY alone is legitimately just the search key.
        const partial = get(env, `${prefix}_BASE_URL`) || (name !== 'ollama' && get(env, `${prefix}_API_KEY`))
        if (partial) warnings.push(`${name}: found ${prefix}_* settings but ${spec}; skipping`)
      }
      continue
    }
    if (name !== 'anthropic' && !search) {
      warnings.push(`${name}: ${GATEWAYS[name].prefix}_MODEL is set but there is no search backend (BRAVE_API_KEY, SEARXNG_URL, or OLLAMA_API_KEY); skipping`)
      continue
    }
    providers.push(spec)
  }
  if (!providers.length) throw new Error(`No research provider is configured.\n${warnings.map((w) => `  ${w}\n`).join('')}${SETUP_HELP}`)
  return { providers, search, warnings }
}

export function describe(d: Detection): string {
  const gw = d.providers.some((p) => p.name !== 'anthropic')
  return `providers: ${d.providers.map((p) => `${p.name}(${p.model})`).join(', ')}${gw && d.search ? ` | search: ${d.search.backend}` : ''}`
}

export function buildProvider(spec: ProviderSpec, search: SearchConfig | undefined): ResearchProvider {
  const label = `${spec.name}(${spec.model})`
  if (spec.name === 'anthropic') return anthropicProvider({ label, model: spec.model, apiKey: spec.apiKey! })
  if (!search) throw new Error(`${spec.name} needs a search backend`)
  return openAICompatProvider({ label, baseUrl: spec.baseUrl!, model: spec.model, apiKey: spec.apiKey, tools: makeWebTools(search) })
}
