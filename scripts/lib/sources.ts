import { USER_AGENT } from './web-tools.ts'

/** True when every URL resolves. 403 and 429 count as reachable: many publishers wall off bots. Mirrored by
 * `HttpSourceChecker` in api/src/pipeline.rs. */
export async function sourcesReachable(urls: string[], log: (s: string) => void = console.log): Promise<boolean> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) })
      if (res.status >= 400 && res.status !== 403 && res.status !== 429) {
        log(`source ${url} -> ${res.status}`)
        return false
      }
    } catch (e) {
      log(`source ${url} -> ${(e as Error).message}`)
      return false
    }
  }
  return true
}
