# Felony Bench

**The Open LLM Felony Leaderboard.** One benchmark: documented criminal and criminal-adjacent conduct attributed to large language models, scored by model and by provider. Every entry links to its source. The score you want is zero.

No model or provider listed has been charged with or convicted of a crime. Models have no legal personhood. We score them anyway. Read the [methodology](src/pages/MethodologyPage.tsx) before reading the number.

## Architecture

```
React SPA (Vite) ──HTTP──▶ api/  Rust · tokio · axum · sqlx ──▶ Postgres
                                  ▲ LISTEN data_changed            ▲
scripts/refresh-incidents.ts (daily) ─── inserts + NOTIFY ─────────┘
```

- **Postgres is the source of truth.** The schema lives in `api/migrations/`. Foreign keys and deferred triggers enforce the same referential rules as `crossCheck` in `src/data/schema.ts`.
- **The API keeps the whole dataset in memory.** It serves `/api/bootstrap` pre-serialized and pre-compressed (brotli/gzip, ETag + 304), so public reads never touch the database. The snapshot is swapped atomically whenever `NOTIFY data_changed` fires. On a laptop that's about 55k req/s for the full dataset in ~60 MB of RAM.
- **The SPA fetches `/api/bootstrap` once** and scores everything client-side (`src/lib/score.ts`).
- **Public submissions** go into a review queue. Admins approve or reject them at `/admin`, and approval runs the same pipeline as the daily refresh.

## Run it

Needs Node 24 + pnpm, Rust (stable), and Postgres (Docker is easiest).

```bash
pnpm install
cp .env.example .env    # set ADMIN_TOKEN (openssl rand -hex 24)
pnpm db:up              # Postgres 17 in Docker on :5432
pnpm db:seed            # migrate + import data/seed/*.json (idempotent)
pnpm dev                # Vite on :5173 + API on :8787 (/api is proxied)
```

| Command | What |
|---|---|
| `pnpm check` | typecheck + validate the seed JSON |
| `pnpm test` | TS tests (scoring, pipeline, dedupe parity, DB queries on PGlite) |
| `pnpm test:api` | Rust tests. Integration tests need `DATABASE_URL` and create throwaway databases |
| `pnpm build` | static SPA in `dist/` |
| `pnpm db:export` | dump the database back to `data/seed/*.json` |
| `docker compose up -d --build` | full stack: the API serves the SPA on :8787. Seed once with `docker compose run --rm api felony-api seed` |

## API

| Route | |
|---|---|
| `GET /api/bootstrap` | `{ providers, models, incidents, meta }`: everything the site needs |
| `GET /api/incidents` | filters: `category`, `evidenceClass`, `provider`, `model`, `since`, `until`, `limit` |
| `GET /api/incidents/:id`, `/api/providers`, `/api/models`, `/api/meta`, `/api/health` | |
| `POST /api/submissions` | `{ incident, candidateModels?, note?, contact? }`. 5 per hour per IP, honeypot field, 32 KB limit |
| `GET /api/admin/submissions?status=pending` | `Authorization: Bearer $ADMIN_TOKEN` |
| `POST /api/admin/submissions/:id/approve` | optional `{ incident }` correction. Runs the pipeline, then 422 with `reason` if rejected |
| `POST /api/admin/submissions/:id/reject` | `{ note }` |

Configuration is via environment variables (see `.env.example` and `felony-api serve --help`).

## Data

| Where | What |
|---|---|
| `providers` | The roster. Listed even at a score of 0. |
| `models` | Models, each pointing at a provider. |
| `incidents` (+ `incident_models`, `incident_providers`, `incident_sources`) | The docket. Each incident has a date, category, degree (1–3), evidence class, role, attribution confidence, and at least one https source. |
| `refresh_runs` | One row per refresh run; the latest becomes `meta`. |
| `submissions` | The public review queue. Only a salted hash of the submitter IP is stored. |

`data/seed/` holds a JSON snapshot in the original file format, used to seed fresh databases and as a readable backup. Controlled vocabularies live in `shared/enums.json`; tests on both sides keep the zod schema, the Rust validator and the database CHECK constraints in sync.

## Submit a felony

Use the **Submit a felony** form on the site. Entries are reviewed before they go live. Keep the summary to 1–3 neutral, attributive sentences; the source must say what the entry says. Corrections to existing entries go through an issue.

## Automated refresh

A systemd timer on the host (`deploy/systemd/felony-refresh.timer`) runs `scripts/refresh-incidents.ts` daily at 06:17 UTC. It calls Claude with web search, asks for new sourced incidents, then applies deterministic guardrails in `scripts/lib/pipeline.ts`:

- zod schema validation
- duplicate detection against the docket (normalized source URL, or similar title within 30 days from the same provider)
- a live fetch of every source URL
- roster checks; unknown models are dropped, unknown providers reject the incident
- a cap of 10 additions per run
- append-only: existing entries are never edited or removed

What passes is inserted into Postgres in one transaction (the database re-checks every reference at commit), and running API instances reload within a second via `NOTIFY`.

### Trigger it by hand

- On the host (via `aws ssm start-session`): `sudo systemctl start felony-refresh`, or `sudo /opt/felony/src/deploy/refresh.sh --max=10 --dry-run` to preview. Logs: `journalctl -u felony-refresh`
- Locally: `DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm refresh --dry-run`, then without the flag to write

The host reads `ANTHROPIC_API_KEY` from SSM Parameter Store (`/felony-bench/env/ANTHROPIC_API_KEY`) and skips the run until it exists.

## Hosting

One EC2 instance (t4g.small) runs Postgres, the API, Caddy (HTTPS) and the daily refresh in Docker, defined with AWS CDK in `infra/`. CI builds arm64 images to GHCR on `main` and deploys them through SSM. See [infra/README.md](infra/README.md).

If the SPA is ever hosted separately from the API, build it with `VITE_API_URL=https://your-api` and set `CORS_ORIGIN` on the API. Update `REPO_URL` in `src/data/index.ts` if the repository moves.

## Stack

Frontend: Vite, React 19, TypeScript, CSS Modules, React Router, Recharts, zod. API: Rust, tokio, axum, sqlx, Postgres. The refresh script uses the Anthropic TypeScript SDK with the web search and web fetch server tools, and postgres.js.
