#!/usr/bin/env bash
# Deploy compose.prod.yml at a commit on the EC2 host (infra/): deploy.sh <git sha>, or deploy.sh latest for main.
# Run as root by first boot (user data) and by CI through SSM Run Command. CI tags images sha-<7-char sha>.
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

if [ "$REF" = latest ]; then TAG=latest; else TAG="sha-${REF:0:7}"; fi
echo "[deploy] $(git -C "$SRC" rev-parse --short HEAD), images $TAG"

# set_env NAME VALUE: replace or append one line in .env (written in place: .env is a symlink).
set_env() {
  local tmp
  tmp="$(mktemp)"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}
set_env IMAGE_TAG "$TAG"

# Refresh provider settings: every SSM parameter under /felony-bench/env/ becomes a .env line
# named after its last path segment (e.g. /felony-bench/env/ANTHROPIC_API_KEY).
IMDS=http://169.254.169.254/latest
TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' "$IMDS/api/token")"
AWS_DEFAULT_REGION="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/placement/region")"
export AWS_DEFAULT_REGION
while IFS=$'\t' read -r name value; do
  if [ -n "$name" ]; then set_env "${name##*/}" "$value"; fi
done < <(aws ssm get-parameters-by-path --path /felony-bench/env/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text)

DC=(docker compose --project-directory "$SRC" -f "$SRC/compose.prod.yml")
"${DC[@]}" pull --quiet
"${DC[@]}" up -d --wait --remove-orphans
# Caddy doesn't watch its bind-mounted config.
"${DC[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
docker image prune -f >/dev/null
echo "[deploy] done"
