#!/bin/sh
# Nightly pg_dump into /backups, keeping $BACKUP_KEEP_DAYS days. Runs in the postgres image (compose.prod.yml).
#   Restore: docker compose -f compose.prod.yml exec -T db pg_restore --clean --if-exists -U felony -d felony < backups/<file>.dump
set -eu
backup_once() {
  file="/backups/felony-$(date -u +%Y%m%d-%H%M%S).dump"
  pg_dump -Fc -f "$file.partial" && mv "$file.partial" "$file"
  find /backups -name 'felony-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete
  echo "[backup] wrote $file"
}
[ "${1:-}" = "--once" ] && { backup_once; exit; }
while :; do
  # Next $BACKUP_HOUR:00 UTC.
  now=$(date -u +%s)
  next=$(( now / 86400 * 86400 + BACKUP_HOUR * 3600 ))
  [ "$next" -le "$now" ] && next=$(( next + 86400 ))
  sleep $(( next - now ))
  backup_once || echo "[backup] failed" >&2
done
