import { API_BASE } from '../data'

/** Thrown for any non-2xx response. `body` is the parsed JSON body when there is one. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  /** The `error` string from a `{ error }` body, if present. */
  get serverMessage(): string | undefined {
    return field(this.body, 'error')
  }
}

export function field(body: unknown, key: string): string | undefined {
  if (body && typeof body === 'object' && key in body) {
    const v = (body as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

type ApiInit = Omit<RequestInit, 'body'> & { json?: unknown; token?: string }

/** fetch() against the API. Sends/parses JSON, throws ApiError on non-2xx, network errors propagate as TypeError. */
export async function apiFetch<T>(path: string, { json, token, headers, ...init }: ApiInit = {}): Promise<T> {
  const h = new Headers(headers)
  h.set('Accept', 'application/json')
  if (json !== undefined) h.set('Content-Type', 'application/json')
  if (token) h.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: h, body: json === undefined ? undefined : JSON.stringify(json) })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) throw new ApiError(res.status, body, field(body, 'error') ?? `Request failed with ${res.status}`)
  return body as T
}

/** Human-readable message for anything apiFetch can throw. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.serverMessage ?? err.message
  if (err instanceof Error) return err.name === 'TypeError' ? 'Could not reach the server.' : err.message
  return String(err)
}
