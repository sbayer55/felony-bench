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
| `docker compose up -d --build` | local full stack: the API serves the SPA on :8787. Seed once with `docker compose run --rm api felony-api seed`. For production see [Deploy](#deploy) |

## Deploy

`compose.prod.yml` runs the whole thing on one Docker host:

| Service | |
|---|---|
| `caddy` | HTTPS on :80/:443 with automatic Let's Encrypt certificates for `$DOMAIN`; the only service with published ports |
| `api` | `ghcr.io/sbayer55/felony-bench`: the API plus the built SPA, read-only filesystem, health-checked |
| `seed` | runs once per `up`: migrates, and imports `data/seed` only into a database that has never been seeded |
| `db` | Postgres 17 on an internal network, data in the `pgdata` volume |
| `refresh` | `ghcr.io/sbayer55/felony-bench-refresh`: the daily refresh on `$REFRESH_SCHEDULE` (cron, UTC) |
| `backup` | nightly `pg_dump` into `./backups`, kept `$BACKUP_KEEP_DAYS` days |

```bash
# on the server, with Docker and DNS for your domain pointing at it
git clone https://github.com/sbayer55/felony-bench && cd felony-bench
cp .env.example .env    # fill in the Production block, plus ADMIN_TOKEN, IP_SALT, ANTHROPIC_API_KEY
docker compose -f compose.prod.yml up -d
```

The site is at `https://$DOMAIN`, the review queue at `https://$DOMAIN/admin`. CI pushes images on every commit to `main` (tags `latest` and `sha-<commit>`, linux/amd64). Until the GHCR packages are made public, run `docker login ghcr.io` on the server, or add `--build` to build locally (also the way to get an arm64 image). `DOMAIN=localhost` tries the stack on your machine with a self-signed certificate.

| Task | Command (prefix with `docker compose -f compose.prod.yml`) |
|---|---|
| Update | `pull && … up -d` (pin a version with `IMAGE_TAG=sha-…` in `.env`) |
| Logs | `logs -f api refresh` |
| Refresh now | `exec refresh tsx scripts/refresh-incidents.ts --dry-run`, then without the flag |
| Back up now | `exec backup /bin/sh /backup.sh --once` |
| Restore | `exec -T db pg_restore --clean --if-exists -U felony -d felony < backups/<file>.dump` |
| Export to JSON | `exec api felony-api export /tmp/seed` then `cp` it out |

When the refresh runs in the stack, leave the `DATABASE_URL` repository secret unset so the GitHub Actions refresh keeps skipping itself.

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

The refresh runs daily at 06:17 UTC, either in the `refresh` container of the production stack or from `.github/workflows/refresh.yml`. It calls Claude with web search, asks for new sourced incidents, then applies deterministic guardrails in `scripts/lib/pipeline.ts`:

- zod schema validation
- duplicate detection against the docket (normalized source URL, or similar title within 30 days from the same provider)
- a live fetch of every source URL
- roster checks; unknown models are dropped, unknown providers reject the incident
- a cap of 10 additions per run
- append-only: existing entries are never edited or removed

What passes is inserted into Postgres in one transaction (the database re-checks every reference at commit), and running API instances reload within a second via `NOTIFY`.

### Trigger it by hand

- GitHub: **Actions → Refresh incidents → Run workflow** (inputs: `max`, `since`, `dry_run`)
- CLI: `gh workflow run refresh.yml -f max=10`
- Locally: `DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm refresh --dry-run`, then without the flag to write
- Self-hosted stack: see [Deploy](#deploy)

### Setup

- Self-hosting with `compose.prod.yml` runs the refresh inside the stack; nothing to set up on GitHub.
- To run it from GitHub Actions instead (e.g. with a managed Postgres), add `DATABASE_URL` and `ANTHROPIC_API_KEY` repository secrets. The workflow skips itself until `DATABASE_URL` exists.
- If the SPA is hosted separately from the API, build it with `VITE_API_URL=https://your-api` and set `CORS_ORIGIN` on the API.
- Update `REPO_URL` in `src/data/index.ts` if the repository moves.

## Stack

Frontend: Vite, React 19, TypeScript, CSS Modules, React Router, Recharts, zod. API: Rust, tokio, axum, sqlx, Postgres. The refresh script uses the Anthropic TypeScript SDK with the web search and web fetch server tools, and postgres.js.
