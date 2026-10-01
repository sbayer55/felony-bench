#!/usr/bin/env bash
# Daily incident refresh (felony-refresh.timer). Provider keys come from SSM Parameter Store:
# every parameter under /felony-bench/env/ becomes an env var named after its last path segment.
set -euo pipefail
# cloud-init and SSM Run Command may start without HOME; docker and git want one.
export HOME="${HOME:-/root}"

DC="$(dirname "$(readlink -f "$0")")/dc"
TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)"
AWS_DEFAULT_REGION="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)"
export AWS_DEFAULT_REGION

args=()
while IFS=$'\t' read -r name value; do
  [ -n "$name" ] || continue
  export "${name##*/}=$value"
  args+=(-e "${name##*/}")
done < <(aws ssm get-parameters-by-path --path /felony-bench/env/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text)

if [ "${#args[@]}" -eq 0 ]; then
  echo "[refresh] no parameters under /felony-bench/env/; skipping (see infra/README.md)"
  exit 0
fi

"$DC" pull --quiet refresh
"$DC" --profile refresh run --rm "${args[@]}" refresh "$@"
