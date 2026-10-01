# Felony Bench

**The Open LLM Felony Leaderboard.** One benchmark: documented criminal and criminal-adjacent conduct attributed to large language models, scored by model and by provider. Every entry links to its source. The score you want is zero.

No model or provider listed has been charged with or convicted of a crime. Models have no legal personhood. We score them anyway. Read the [methodology](src/pages/MethodologyPage.tsx) before reading the number.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # typecheck + data validation
pnpm test       # scoring and refresh-pipeline tests
pnpm build      # static site in dist/
```

## Data

Three JSON files in `src/data/` drive everything:

| File | What |
|---|---|
| `providers.json` | The roster of providers. Listed even at a score of 0. |
| `models.json` | Models, each pointing at a provider. |
| `incidents.json` | The docket. Each incident has a date, category, degree (1–3), evidence class, role, attribution confidence, and at least one https source. |
| `meta.json` | Written by the refresh job: last run time and counts. |

Schema and cross-file checks live in `src/data/schema.ts`. `pnpm check` fails on any schema error, unknown model or provider id, or non-https source.

## Submit a felony

1. Fork the repo.
2. Add an entry to `src/data/incidents.json`. Add the model to `src/data/models.json` if it is new.
3. Keep the summary to 1–3 neutral, attributive sentences. The source must say what the entry says.
4. Run `pnpm check`.
5. Open a pull request with the source linked in the description.

Corrections to existing entries follow the same path or go through an issue.

## Automated refresh

`.github/workflows/refresh.yml` runs daily at 06:17 UTC. It calls Claude with web search, asks for new sourced incidents, then applies deterministic guardrails in `scripts/lib/pipeline.ts`:

- zod schema validation
- duplicate detection against the docket (normalized source URL, or similar title within 30 days from the same provider)
- a live fetch of every source URL
- roster checks; unknown models are dropped, unknown providers reject the incident
- a cap of 10 additions per run
- append-only: existing entries are never edited or removed

What passes is committed to `main` and the site redeploys.

### Trigger it by hand

- GitHub: **Actions → Refresh incidents → Run workflow** (inputs: `max`, `since`, `dry_run`)
- CLI: `gh workflow run refresh.yml -f max=10`
- Locally: `ANTHROPIC_API_KEY=… pnpm refresh --dry-run`, then without the flag to write

### Setup

- Add an `ANTHROPIC_API_KEY` repository secret.
- Enable GitHub Pages with **Source: GitHub Actions**. The deploy workflow builds with `BASE_PATH=/<repo>/`.
- Update `REPO_URL` in `src/data/index.ts` if the repository moves.

## Stack

Vite, React 19, TypeScript, CSS Modules, React Router, Recharts, zod. The refresh script uses the Anthropic TypeScript SDK with the web search and web fetch server tools.
