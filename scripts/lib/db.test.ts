import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { IncidentsFile, ModelsFile, ProvidersFile } from '../../src/data/schema.ts'
import { type Db, insertIncident, insertModel, loadAll, notifyChanged, recordRun } from './db.ts'

const root = resolve(import.meta.dirname, '../..')
const seed = (name: string) => JSON.parse(readFileSync(resolve(root, 'data/seed', name), 'utf8'))
const providers = ProvidersFile.parse(seed('providers.json'))
const models = ModelsFile.parse(seed('models.json'))
const incidents = IncidentsFile.parse(seed('incidents.json'))

type Queryable = Pick<PGlite, 'query'>
function adapt(pg: Queryable & Partial<Pick<PGlite, 'transaction'>>): Db {
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    transaction: (fn) => pg.transaction!((tx) => fn(adapt(tx))),
    close: async () => {},
  }
}

async function freshDb(): Promise<Db> {
  const pg = new PGlite()
  const dir = resolve(root, 'api/migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(resolve(dir, f), 'utf8'))
  return adapt(pg)
}

async function seedAll(db: Db) {
  await db.transaction(async (tx) => {
    for (const p of providers) {
      await tx.query('INSERT INTO providers (id, name, url, country, founded) VALUES ($1, $2, $3, $4, $5)', [p.id, p.name, p.url, p.country ?? null, p.founded ?? null])
    }
    for (const m of models) await insertModel(tx, m)
    for (const i of [...incidents].reverse()) await insertIncident(tx, i)
  })
}

describe('db (PGlite, real migrations)', () => {
  let db: Db
  beforeEach(async () => {
    db = await freshDb()
    await seedAll(db)
  })

  it('round-trips the seed snapshot', async () => {
    const snap = await loadAll(db)
    expect(snap.providers).toEqual(providers)
    expect(snap.models).toEqual(models)
    expect(snap.incidents).toEqual(incidents)
    expect(snap.meta).toEqual({ lastRefreshed: null, lastRunAdded: 0, lastRunRejected: 0, runId: null })
  }, 30_000)

  it('records runs and notifies inside a transaction', async () => {
    await db.transaction(async (tx) => {
      await recordRun(tx, { startedAt: new Date('2026-09-30T06:17:00Z'), added: 2, rejected: 3, ghRunId: '42' })
      await notifyChanged(tx)
    })
    const { meta } = await loadAll(db)
    expect(meta).toMatchObject({ lastRunAdded: 2, lastRunRejected: 3, runId: '42' })
    expect(meta.lastRefreshed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  }, 30_000)

  it('rolls back when an incident lists a model without its provider', async () => {
    const bad = { ...incidents[0], id: 'bad-incident', modelIds: ['chatgpt'], providerIds: ['anthropic'] }
    await expect(db.transaction((tx) => insertIncident(tx, bad))).rejects.toThrow(/lists model chatgpt but not its provider/)
    expect((await loadAll(db)).incidents.some((i) => i.id === 'bad-incident')).toBe(false)
  }, 30_000)
})
