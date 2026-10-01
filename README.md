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

`.github/workflows/refresh.yml` runs daily at 06:17 UTC. It asks every configured LLM provider (Claude, Ollama, Bifrost, 9router; see below) to search the web for new sourced incidents, pools their candidates, then applies deterministic guardrails in `scripts/lib/pipeline.ts`:

- zod schema validation
- duplicate detection against the docket (normalized source URL, or similar title within 30 days from the same provider)
- a live fetch of every source URL
- roster checks; unknown models are dropped, unknown providers reject the incident
- a cap of 10 additions per run
- append-only: existing entries are never edited or removed

What passes is committed to `main` and the site redeploys.

### Trigger it by hand

- GitHub: **Actions → Refresh incidents → Run workflow** (inputs: `max`, `since`, `dry_run`, `providers`)
- CLI: `gh workflow run refresh.yml -f max=10`
- Locally: `ANTHROPIC_API_KEY=… pnpm refresh --dry-run`, then without the flag to write
- Locally with Ollama: `OLLAMA_MODEL=qwen3:32b BRAVE_API_KEY=… pnpm refresh --dry-run`

### Providers

The script enables every provider whose config it finds in the environment and runs them in parallel. Their candidates are interleaved and go through the same guardrails, so duplicates across providers are dropped. One provider failing doesn't stop the others; the run fails only if all of them fail.

| Provider | Enabled by | Optional |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (default `claude-opus-5-5`) |
| Ollama | `OLLAMA_MODEL` | `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`), `OLLAMA_API_KEY` |
| Bifrost | `BIFROST_MODEL` (e.g. `openai/gpt-…`) | `BIFROST_BASE_URL` (default `http://localhost:8080/v1`), `BIFROST_API_KEY` |
| 9router | `NINEROUTER_MODEL` | `NINEROUTER_BASE_URL` (default `http://localhost:20128/v1`), `NINEROUTER_API_KEY` |

Claude uses Anthropic's server-side web search. Ollama, Bifrost and 9router go through their OpenAI-compatible `/chat/completions` endpoint, and the script runs search and fetch for them, using the first search backend it finds: `BRAVE_API_KEY` (Brave Search), `SEARXNG_URL` (a SearXNG instance), or `OLLAMA_API_KEY` (Ollama web search). Set `SEARCH_BACKEND=brave|searxng|ollama` to pick one. A gateway with no search backend is skipped with a warning.

To choose providers explicitly, set `REFRESH_PROVIDERS` or pass `--providers=`, e.g. `anthropic,bifrost,ollama:qwen3:32b`. A `name:model` entry overrides the model, so one provider can run twice with different models. Explicitly named providers that aren't configured are an error.

### Setup

- Add repository secrets/variables for the providers you want. API keys (`ANTHROPIC_API_KEY`, `*_API_KEY`, `BRAVE_API_KEY`) go in **secrets**; models, base URLs, `SEARCH_BACKEND`, `SEARXNG_URL` and `REFRESH_PROVIDERS` go in **variables**.
- GitHub-hosted runners can't reach `localhost`. To use a local Ollama or 9router, register a self-hosted runner and set the `REFRESH_RUNNER` variable to its label, or point `*_BASE_URL` at a reachable host.
- Enable GitHub Pages with **Source: GitHub Actions**. The deploy workflow builds with `BASE_PATH=/<repo>/`.
- Update `REPO_URL` in `src/data/index.ts` if the repository moves.

## Stack

Vite, React 19, TypeScript, CSS Modules, React Router, Recharts, zod. The refresh script uses the Anthropic TypeScript SDK with the web search and web fetch server tools, and plain `fetch` against OpenAI-compatible endpoints for the other providers.
