import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { IncidentsFile, MetaSchema, ModelsFile, ProvidersFile, crossCheck } from '../src/data/schema.ts'

const dataDir = resolve(import.meta.dirname, '../src/data')
const load = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf8'))

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T | null {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  for (const issue of r.error.issues) {
    console.error(`${label}: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return null
}

const providers = parse(ProvidersFile, load('providers.json'), 'providers.json')
const models = parse(ModelsFile, load('models.json'), 'models.json')
const incidents = parse(IncidentsFile, load('incidents.json'), 'incidents.json')
const meta = parse(MetaSchema, load('meta.json'), 'meta.json')

let failed = !providers || !models || !incidents || !meta
if (providers && models && incidents) {
  const errors = crossCheck(providers, models, incidents)
  for (const e of errors) console.error(e)
  if (errors.length) failed = true
}

if (failed) {
  console.error('\nData validation failed.')
  process.exit(1)
}
console.log(
  `Data OK: ${providers!.length} providers, ${models!.length} models, ${incidents!.length} incidents.`,
)
