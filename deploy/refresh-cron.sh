#!/bin/sh
# Runs the incident refresh on $REFRESH_SCHEDULE (cron syntax, UTC) under supercronic.
set -eu
crontab=/tmp/refresh.crontab
echo "$REFRESH_SCHEDULE tsx scripts/refresh-incidents.ts --max=$REFRESH_MAX" > "$crontab"
echo "[refresh-cron] schedule: $REFRESH_SCHEDULE (max $REFRESH_MAX)"
exec supercronic -passthrough-logs "$crontab"
