import { describe, expect, it } from 'vitest'
import { detectProviders } from './providers.ts'

describe('detectProviders', () => {
  it('detects anthropic from its key alone', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k' })
    expect(d.providers.map((p) => [p.name, p.model])).toEqual([['anthropic', 'claude-opus-5-5']])
    expect(d.search).toBeUndefined()
  })

  it('detects a gateway plus search backend', () => {
    const d = detectProviders({ OLLAMA_MODEL: 'qwen3:32b', BRAVE_API_KEY: 'b' })
    expect(d.providers).toEqual([{ name: 'ollama', model: 'qwen3:32b', baseUrl: 'http://localhost:11434/v1', apiKey: undefined }])
    expect(d.search).toEqual({ backend: 'brave', apiKey: 'b' })
  })

  it('detects several providers at once', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k', BIFROST_MODEL: 'openai/x', NINEROUTER_MODEL: 'y', NINEROUTER_BASE_URL: 'http://box:20128/v1', SEARXNG_URL: 'http://sx' })
    expect(d.providers.map((p) => p.name)).toEqual(['anthropic', 'bifrost', '9router'])
    expect(d.providers[2].baseUrl).toBe('http://box:20128/v1')
    expect(d.search?.backend).toBe('searxng')
  })

  it('uses the Ollama key as a search backend', () => {
    const d = detectProviders({ BIFROST_MODEL: 'm', OLLAMA_API_KEY: 'o' })
    expect(d.search).toEqual({ backend: 'ollama', apiKey: 'o' })
    expect(d.warnings).toEqual([])
  })

  it('skips a gateway without a search backend', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k', OLLAMA_MODEL: 'm' })
    expect(d.providers.map((p) => p.name)).toEqual(['anthropic'])
    expect(d.warnings[0]).toMatch(/ollama.*search backend/)
  })

  it('warns on partial gateway config', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k', BIFROST_BASE_URL: 'http://b' })
    expect(d.warnings[0]).toMatch(/BIFROST_MODEL is not set/)
  })

  it('treats empty strings as unset', () => {
    expect(() => detectProviders({ ANTHROPIC_API_KEY: '', OLLAMA_MODEL: ' ', REFRESH_PROVIDERS: '' })).toThrow(/No research provider/)
  })

  it('throws with setup help when nothing is configured', () => {
    expect(() => detectProviders({})).toThrow(/ANTHROPIC_API_KEY[\s\S]*OLLAMA_MODEL/)
  })

  it('honors an explicit list with model overrides', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k', OLLAMA_MODEL: 'a', BRAVE_API_KEY: 'b' }, 'anthropic,ollama:qwen3:32b,ollama')
    expect(d.providers.map((p) => `${p.name}:${p.model}`)).toEqual(['anthropic:claude-opus-5-5', 'ollama:qwen3:32b', 'ollama:a'])
  })

  it('reads the list from REFRESH_PROVIDERS', () => {
    const d = detectProviders({ ANTHROPIC_API_KEY: 'k', BIFROST_MODEL: 'm', BRAVE_API_KEY: 'b', REFRESH_PROVIDERS: 'bifrost' })
    expect(d.providers.map((p) => p.name)).toEqual(['bifrost'])
  })

  it('errors on explicitly named but unconfigured providers', () => {
    expect(() => detectProviders({ ANTHROPIC_API_KEY: 'k' }, 'anthropic,bifrost')).toThrow(/bifrost: BIFROST_MODEL is not set/)
    expect(() => detectProviders({ OLLAMA_MODEL: 'm' }, 'ollama')).toThrow(/no search backend/)
  })

  it('rejects unknown provider names', () => {
    expect(() => detectProviders({ ANTHROPIC_API_KEY: 'k' }, 'openrouter')).toThrow(/unknown provider "openrouter"/)
  })

  it('validates a forced search backend', () => {
    expect(() => detectProviders({ ANTHROPIC_API_KEY: 'k', SEARCH_BACKEND: 'brave' })).toThrow(/BRAVE_API_KEY/)
    expect(detectProviders({ BIFROST_MODEL: 'm', BRAVE_API_KEY: 'b', SEARXNG_URL: 'http://s', SEARCH_BACKEND: 'searxng' }).search?.backend).toBe('searxng')
  })
})
