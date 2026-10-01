#!/usr/bin/env bash
# Deploy a commit: deploy.sh <git sha>, or deploy.sh latest for main.
# Run as root on the host by first boot (user data) and by CI through SSM Run Command.
set -euo pipefail
# cloud-init and SSM Run Command may start without HOME; docker and git want one.
export HOME="${HOME:-/root}"

SRC=/opt/felony/src
ENV_FILE=/data/felony/.env
REF="${1:?usage: deploy.sh <sha|latest>}"

# Check out the requested commit, then re-run the script from it.
if [ "${2:-}" != "--checked-out" ]; then
  git -C "$SRC" fetch --quiet origin main
  if [ "$REF" = latest ]; then
    git -C "$SRC" checkout --quiet --force --detach origin/main
  else
    git -C "$SRC" checkout --quiet --force --detach "$REF"
  fi
  exec "$SRC/deploy/deploy.sh" "$REF" --checked-out
fi

DC="$SRC/deploy/dc"
echo "[deploy] $(git -C "$SRC" rev-parse --short HEAD) image tag $REF"

sed -i "s/^TAG=.*/TAG=$REF/" "$ENV_FILE"
mkdir -p /data/pgdata /data/caddy/data /data/caddy/config

install -m 0644 "$SRC"/deploy/systemd/felony-refresh.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet --now felony-refresh.timer

"$DC" pull --quiet
"$DC" up -d --remove-orphans
# Caddy doesn't watch its bind-mounted config.
"$DC" exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
# Migrations run when the API starts; seeding only inserts rows that don't exist yet.
"$DC" run --rm api felony-api seed
docker image prune -f >/dev/null
echo "[deploy] done"
