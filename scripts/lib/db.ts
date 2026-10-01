/**
 * Postgres access for the refresh job. The schema is owned by the Rust API (api/migrations); the read query mirrors
 * `load_all` in api/src/repo.rs. Written against a tiny `Db` interface so tests can run on PGlite.
 */
import postgres from 'postgres'
import type { Incident, Meta, Model, Provider } from '../../src/data/schema.ts'

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  /** Runs `fn` in a transaction; commits on return, rolls back on throw. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function connect(url: string): Db {
  const sql = postgres(url, { max: 2, onnotice: () => {} })
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Omit<Db, 'transaction' | 'close'> => ({
    query: async <T>(text: string, params: unknown[] = []) => (await s.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
  })
  return {
    ...wrap(sql),
    transaction: async <T>(fn: (tx: Db) => Promise<T>) =>
      (await sql.begin((tx) => fn({ ...wrap(tx), transaction: () => Promise.reject(new Error('nested transaction')), close: async () => {} }))) as T,
    close: () => sql.end({ timeout: 5 }),
  }
}

export interface Snapshot {
  providers: Provider[]
  models: Model[]
  incidents: Incident[]
  meta: Meta
}

/** Drops null optional fields so objects match the zod shapes (and the seed JSON). */
function compact<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) as T
}

export async function loadAll(db: Db): Promise<Snapshot> {
  const providers = (await db.query<Provider>('SELECT id, name, url, country, founded FROM providers ORDER BY seq')).map(compact)
  const models = (
    await db.query<Model>(
      `SELECT id, name, provider_id AS "providerId", family, to_char(released, 'YYYY-MM-DD') AS released, aliases FROM models ORDER BY seq`,
    )
  ).map(compact)
  const incidents = (
    await db.query<Incident>(`
      SELECT i.id, to_char(i.date, 'YYYY-MM-DD') AS date, i.title, i.summary,
             COALESCE((SELECT array_agg(model_id ORDER BY position) FROM incident_models WHERE incident_id = i.id), '{}') AS "modelIds",
             COALESCE((SELECT array_agg(provider_id ORDER BY position) FROM incident_providers WHERE incident_id = i.id), '{}') AS "providerIds",
             i.category, i.degree, i.evidence_class AS "evidenceClass", i.role, i.attribution_confidence AS "attributionConfidence",
             COALESCE((SELECT json_agg(json_build_object('title', title, 'url', url, 'publisher', publisher,
                                                         'date', to_char(date, 'YYYY-MM-DD')) ORDER BY position)
                       FROM incident_sources WHERE incident_id = i.id), '[]') AS sources,
             i.tags
      FROM incidents i
      ORDER BY i.date DESC, i.id COLLATE "C"`)
  ).map(compact)
  const [run] = await db.query<{ at: string; added: number; rejected: number; gh_run_id: string | null }>(
    `SELECT to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, added, rejected, gh_run_id
     FROM refresh_runs ORDER BY id DESC LIMIT 1`,
  )
  const meta: Meta = run
    ? { lastRefreshed: run.at, lastRunAdded: run.added, lastRunRejected: run.rejected, runId: run.gh_run_id }
    : { lastRefreshed: null, lastRunAdded: 0, lastRunRejected: 0, runId: null }
  return { providers, models, incidents, meta }
}

export async function insertModel(db: Db, m: Model): Promise<void> {
  await db.query(
    'INSERT INTO models (id, name, provider_id, family, released, aliases) VALUES ($1, $2, $3, $4, $5::date, $6) ON CONFLICT (id) DO NOTHING',
    [m.id, m.name, m.providerId, m.family ?? null, m.released ?? null, m.aliases ?? null],
  )
}

export async function insertIncident(db: Db, inc: Incident): Promise<void> {
  await db.query(
    `INSERT INTO incidents (id, date, title, summary, category, degree, evidence_class, role, attribution_confidence, tags)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [inc.id, inc.date, inc.title, inc.summary, inc.category, inc.degree, inc.evidenceClass, inc.role, inc.attributionConfidence, inc.tags ?? null],
  )
  await db.query(
    'INSERT INTO incident_providers (incident_id, provider_id, position) SELECT $1, p, n - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(p, n)',
    [inc.id, inc.providerIds],
  )
  await db.query(
    'INSERT INTO incident_models (incident_id, model_id, position) SELECT $1, m, n - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(m, n)',
    [inc.id, inc.modelIds],
  )
  await db.query(
    `INSERT INTO incident_sources (incident_id, position, title, url, publisher, date)
     SELECT $1, n - 1, t, u, p, d::date FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS s(t, u, p, d, n)`,
    [inc.id, inc.sources.map((s) => s.title), inc.sources.map((s) => s.url), inc.sources.map((s) => s.publisher), inc.sources.map((s) => s.date)],
  )
}

export async function recordRun(db: Db, run: { startedAt: Date; added: number; rejected: number; ghRunId: string | null }): Promise<void> {
  await db.query('INSERT INTO refresh_runs (started_at, added, rejected, gh_run_id) VALUES ($1, $2, $3, $4)', [
    run.startedAt.toISOString(),
    run.added,
    run.rejected,
    run.ghRunId,
  ])
}

/** Tells running API instances to reload their in-memory snapshot (delivered on commit). */
export async function notifyChanged(db: Db): Promise<void> {
  await db.query(`SELECT pg_notify('data_changed', '')`)
}
