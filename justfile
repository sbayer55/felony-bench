# Felony Bench task runner. `just` lists recipes; most wrap the pnpm scripts in package.json.

set dotenv-load

api := "--manifest-path api/Cargo.toml"

[private]
default:
    @just --list

# First-time setup: install deps, create .env, start and seed Postgres
setup: install
    [ -f .env ] || cp .env.example .env
    just db-up db-seed

# Install JS dependencies
install:
    pnpm install

# Vite on :5173 + API on :8787
dev:
    pnpm dev

# Frontend only
dev-web:
    pnpm dev:web

# API only
dev-api:
    pnpm dev:api

# Static SPA in dist/
build:
    pnpm build

# Typecheck + validate the seed JSON
check:
    pnpm check

# Lint the frontend and scripts
lint:
    pnpm lint

# TS tests; extra args go to vitest (e.g. `just test score`)
test *args:
    pnpm test {{ args }}

# Rust tests; integration tests need DATABASE_URL
test-api *args:
    cargo test {{ api }} {{ args }}

# Format the Rust code
fmt:
    cargo fmt {{ api }}

# Clippy with warnings as errors, as in CI
clippy:
    cargo clippy {{ api }} --all-targets --locked -- -D warnings

# Run everything CI runs
ci: check test build
    cargo fmt {{ api }} --check
    just clippy
    cargo test {{ api }} --locked

# Start Postgres 17 in Docker on :5432 and wait until it's healthy
db-up:
    docker compose up -d --wait db

# Stop the Docker stack (data is kept in the pgdata volume)
db-down:
    docker compose down

# Run migrations
db-migrate:
    pnpm db:migrate

# Migrate + import data/seed/*.json (idempotent)
db-seed:
    pnpm db:seed

# Dump the database back to data/seed/*.json
db-export:
    pnpm db:export

# psql into the local database
db-shell:
    docker compose exec db psql -U felony -d felony

# Wipe the local database volume, then recreate and reseed it
[confirm("This deletes the local Postgres volume. Continue?")]
db-reset:
    docker compose down -v
    just db-up db-seed

# Fetch new incidents via Claude; pass --dry-run to preview
refresh *args:
    pnpm refresh {{ args }}

# Full stack in Docker: the API serves the SPA on :8787
up:
    docker compose up -d --build

# Seed the Docker stack's database
up-seed:
    docker compose run --rm api felony-api seed
