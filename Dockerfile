# Felony Bench: one image serving the API and the built SPA.
#   docker compose up --build

# --- SPA ---
FROM node:24-slim AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src src
COPY scripts scripts
COPY shared shared
RUN pnpm build

# --- daily refresh job (deploy/refresh.sh); extra args go to the script, e.g. --max=10 ---
FROM web AS refresh
USER node
ENTRYPOINT ["node_modules/.bin/tsx", "scripts/refresh-incidents.ts"]

# --- API ---
FROM rust:1-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app/api

FROM chef AS planner
COPY api/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/api/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY shared /app/shared
COPY api/ .
RUN cargo build --release --locked

# --- runtime (default target) ---
FROM debian:bookworm-slim AS app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 felony
WORKDIR /app
COPY --from=builder /app/api/target/release/felony-api /usr/local/bin/felony-api
COPY --from=web /app/dist /app/dist
COPY data/seed /app/data/seed
ENV HOST=0.0.0.0 PORT=8787 STATIC_DIR=/app/dist RUST_LOG=felony_api=info,tower_http=info
USER felony
EXPOSE 8787
# Migrations run on start. Seed a fresh database once with: docker compose run --rm api felony-api seed
CMD ["felony-api", "serve"]
