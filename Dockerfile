# Felony Bench images.
#   default target (api): the API serving the built SPA.   docker compose up --build
#   refresh:              the daily incident refresh on a cron schedule (see compose.prod.yml).

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

# --- refresh job ---
FROM debian:bookworm-slim AS supercronic
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.49
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) sha=e63c11a9726b775a6a11801e81af4f3fb926aa68 ;; \
      arm64) sha=0b6c5bb743e0b0dafed1132198c81807927ac413 ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL -o /supercronic "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}" \
  && echo "$sha  /supercronic" | sha1sum -c - \
  && chmod +x /supercronic

FROM node:24-slim AS refresh
LABEL org.opencontainers.image.source=https://github.com/sbayer55/felony-bench \
      org.opencontainers.image.description="Felony Bench daily incident refresh"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src src
COPY scripts scripts
COPY shared shared
COPY --from=supercronic /supercronic /usr/local/bin/supercronic
COPY deploy/refresh-cron.sh /usr/local/bin/refresh-cron
ENV PATH=/app/node_modules/.bin:$PATH REFRESH_SCHEDULE="17 6 * * *" REFRESH_MAX=10
USER node
# One-off run: docker compose -f compose.prod.yml exec refresh tsx scripts/refresh-incidents.ts --dry-run
CMD ["refresh-cron"]

# --- runtime ---
FROM debian:bookworm-slim AS api
LABEL org.opencontainers.image.source=https://github.com/sbayer55/felony-bench \
      org.opencontainers.image.description="Felony Bench API and site"
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
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["felony-api", "healthcheck"]
# Migrations run on start. Seed a fresh database once with: docker compose run --rm api felony-api seed
CMD ["felony-api", "serve"]
