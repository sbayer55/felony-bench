# Felony Bench task runner. `just` lists recipes; most wrap the pnpm scripts in package.json.

set dotenv-load

api := "--manifest-path api/Cargo.toml"
prod := "docker compose -f compose.prod.yml"

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

# --- Production stack (compose.prod.yml); see README "Deploy" ---

# Start the production stack with images pulled from GHCR
prod-up:
    {{ prod }} up -d --wait

# Build the production images here instead of pulling them, then start the stack
prod-build:
    {{ prod }} up -d --build --wait

# Pull newer images and restart whatever changed
prod-update:
    {{ prod }} pull
    {{ prod }} up -d --wait

# Stop the production stack (database, certificates and backups are kept)
prod-down:
    {{ prod }} down

# Service status
prod-ps:
    {{ prod }} ps -a

# Follow logs; pass services to filter (e.g. `just prod-logs api refresh`)
prod-logs *services:
    {{ prod }} logs -f --tail=100 {{ services }}

# Run the incident refresh now; pass --dry-run to preview
prod-refresh *args:
    {{ prod }} exec refresh tsx scripts/refresh-incidents.ts {{ args }}

# Take a database backup now, into ./backups
prod-backup:
    {{ prod }} exec backup /bin/sh /backup.sh --once

# Restore a backup (e.g. `just prod-restore backups/felony-20261001-040000.dump`)
[confirm("This overwrites the production database with the backup. Continue?")]
prod-restore file:
    {{ prod }} exec -T db pg_restore --clean --if-exists -U felony -d felony < {{ file }}
    {{ prod }} restart api
    {{ prod }} up -d --wait api

# psql into the production database
prod-shell:
    {{ prod }} exec db psql -U felony -d felony

# Dump the production database to data/seed/*.json
prod-export:
    {{ prod }} exec api felony-api export /tmp/seed
    # docker cp can't read the api's tmpfs, so stream the files out
    for f in providers models incidents; do {{ prod }} exec -T api cat /tmp/seed/$f.json > data/seed/$f.json; done
