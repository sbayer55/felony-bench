/**
 * Daily refresh: ask Claude (with web search) for new, sourced incidents, run them through deterministic
 * checks, and append what survives. Append-only; never edits or removes existing entries.
 *
 *   pnpm refresh --dry-run            preview without writing
 *   pnpm refresh --max=5              cap additions this run
 *   pnpm refresh --since=2026-01-01   ignore candidates dated before
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CATEGORIES, CATEGORY_DESCRIPTIONS, DEGREE_DESCRIPTIONS, EVIDENCE_CLASSES, EVIDENCE_DESCRIPTIONS, IncidentsFile, MetaSchema, ModelsFile, ProvidersFile, ROLES, ROLE_DESCRIPTIONS, crossCheck, type Incident, type Meta } from '../src/data/schema.ts'
import { makeClient, research } from './lib/claude.ts'
import { runPipeline } from './lib/pipeline.ts'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1], m[2] ?? 'true')
}
const dryRun = args.get('dry-run') === 'true'
const max = Number(args.get('max') ?? 10)
const since = args.get('since')
const maxSearches = Number(args.get('searches') ?? 30)

const dataDir = resolve(import.meta.dirname, '../src/data')
const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf8'))
const write = (name: string, value: unknown) => writeFileSync(resolve(dataDir, name), `${JSON.stringify(value, null, 2)}\n`)

const providers = ProvidersFile.parse(read('providers.json'))
const models = ModelsFile.parse(read('models.json'))
const existing = IncidentsFile.parse(read('incidents.json'))
const meta = MetaSchema.parse(read('meta.json'))

const log = (s: string) => console.log(`[refresh] ${s}`)
log(`${existing.length} incidents on file, ${models.length} models, ${providers.length} providers. dryRun=${dryRun} max=${max} since=${since ?? '-'}`)

const today = new Date().toISOString().slice(0, 10)
const lastDate = existing[0]?.date ?? '2022-11-30'
const digest = existing
  .slice(0, 120)
  .map((i) => `- ${i.date} | ${i.id} | ${i.providerIds.join(',')} | ${i.title}`)
  .join('\n')

const system = `You are the research editor for Felony Bench, a public leaderboard that tracks documented criminal and criminal-adjacent conduct attributed to large language models. Real companies are named, so you must be accurate, sourced, and neutral. Today is ${today}.

WHAT QUALIFIES
An incident is a specific, dated event in which an LLM's output or action, in production or in a lab evaluation, matched the shape of a crime, or in which humans used an LLM as the instrument of a crime that authorities or the provider documented. Also qualifying: court rulings, sanctions, settlements and regulatory fines that turn on LLM output or training.

Categories (pick one):
${CATEGORIES.map((c) => `- ${c}: ${CATEGORY_DESCRIPTIONS[c]}`).join('\n')}

Degree (1-3):
${([1, 2, 3] as const).map((d) => `- ${d}: ${DEGREE_DESCRIPTIONS[d]}`).join('\n')}

Evidence class:
${EVIDENCE_CLASSES.map((e) => `- ${e}: ${EVIDENCE_DESCRIPTIONS[e]}`).join('\n')}

Role:
${ROLES.map((r) => `- ${r}: ${ROLE_DESCRIPTIONS[r]}`).join('\n')}

RULES
1. Every incident needs at least one https source that you fetched and that supports every claim in your summary. Prefer primary sources: the provider's own report or system card, a court filing or docket entry, a regulator's release, a police statement. Reputable major outlets are acceptable as secondary sources.
2. Summaries are 1-3 sentences in attributive language: "according to", "the system card states", "the court found", "police said". Never editorialize, never speculate, never infer a model that the source does not name. If the source names only a product (e.g. ChatGPT) use the product's model id.
3. Use only provider ids from the roster. Use model ids from the roster when they exist; if a model is genuinely new, add it to candidateModels with its provider id. Never invent a provider.
4. Do not resubmit anything on the existing docket (see the digest in the user message). Different behaviors documented in one system card are distinct incidents; the same story covered by two outlets is one incident.
5. Date: the incident date, or the primary source's publication date if the event date is unknown. Never a future date.
6. If you cannot verify something, leave it out. Returning an empty list is a correct answer.
7. Finish by calling submit_incidents exactly once with everything that passed. Do not write a prose report.

ROSTER
Providers: ${providers.map((p) => p.id).join(', ')}
Models: ${models.map((m) => m.id).join(', ')}`

const prompt = `Find new incidents published or occurring after ${since ?? lastDate} (and anything older that is clearly missing and well documented). Focus on: new system cards and safety reports from frontier labs; provider threat-intelligence reports; coding-agent incidents that destroyed data in production; court sanctions over fabricated citations; criminal cases where police or prosecutors cited an LLM; regulator fines; data breaches at LLM providers. Search broadly, fetch sources to confirm, then submit at most ${max} incidents, best-sourced first.

EXISTING DOCKET (most recent ${Math.min(existing.length, 120)}):
${digest || '(empty)'}`

async function sourcesReachable(urls: string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'felony-bench-refresh/1.0 (+https://github.com/sbayer55/felony-bench)' }, signal: AbortSignal.timeout(15000) })
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

const client = makeClient()
const payload = await research(client, system, prompt, { maxSearches, log })
if (!payload) {
  log('model ended without submitting; nothing to do')
  process.exit(0)
}
log(`model submitted ${payload.incidents.length} candidate(s), ${payload.candidateModels.length} candidate model(s)`)

const result = await runPipeline({
  candidates: payload.incidents,
  candidateModels: payload.candidateModels,
  providers,
  models,
  existing,
  max,
  since,
  sourcesReachable,
})

for (const r of result.rejected) log(`REJECT  ${r.title}\n          ${r.reason}`)
for (const a of result.accepted) log(`ACCEPT  ${a.date} ${a.id}`)
for (const m of result.newModels) log(`MODEL   +${m.id} (${m.providerId})`)

const nextIncidents: Incident[] = [...existing, ...result.accepted].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)))
const nextModels = [...models, ...result.newModels]
const errors = crossCheck(providers, nextModels, nextIncidents)
if (errors.length) {
  for (const e of errors) console.error(`[refresh] INVALID ${e}`)
  process.exit(1)
}

const nextMeta: Meta = {
  lastRefreshed: new Date().toISOString(),
  lastRunAdded: result.accepted.length,
  lastRunRejected: result.rejected.length,
  runId: process.env.GITHUB_RUN_ID ?? meta.runId,
}

if (dryRun) {
  log(`dry run: would add ${result.accepted.length}, reject ${result.rejected.length}. Nothing written.`)
  process.exit(0)
}

write('incidents.json', nextIncidents)
write('models.json', nextModels)
write('meta.json', nextMeta)
log(`wrote ${result.accepted.length} new incident(s). Docket now ${nextIncidents.length}.`)
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `added=${result.accepted.length}\nrejected=${result.rejected.length}\n`, { flag: 'a' })
}
