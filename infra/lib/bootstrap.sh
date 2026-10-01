# First-boot setup, appended to user data after the variables CDK fills in:
#   VOLUME_ID DOMAIN ACME_EMAIL GITHUB_REPO
# Safe to re-run: every step checks before it changes anything.
set -euxo pipefail
# cloud-init and SSM Run Command may start without HOME; docker and git want one.
export HOME="${HOME:-/root}"
exec > >(tee -a /var/log/felony-bootstrap.log) 2>&1

# --- packages ---
dnf install -y docker git
COMPOSE=/usr/local/lib/docker/cli-plugins/docker-compose
if [ ! -x "$COMPOSE" ]; then
  mkdir -p "$(dirname "$COMPOSE")"
  curl -fsSL -o "$COMPOSE" "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)"
  chmod +x "$COMPOSE"
fi
systemctl enable --now docker

# --- swap: 2 GB headroom for Postgres + API + refresh on a 2 GB instance ---
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi
swapon -a

# --- data volume (Postgres, Caddy certs, secrets). Nitro exposes it as NVMe, named by volume id ---
DEV="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${VOLUME_ID//-/}"
for _ in $(seq 1 60); do [ -e "$DEV" ] && break; sleep 5; done
[ -e "$DEV" ] || { echo "data volume $VOLUME_ID never attached"; exit 1; }
if ! blkid "$DEV" >/dev/null 2>&1; then mkfs.xfs "$DEV"; fi
UUID="$(blkid -s UUID -o value "$DEV")"
mkdir -p /data
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data xfs defaults,nofail 0 2" >> /etc/fstab
mountpoint -q /data || mount /data

# --- secrets, generated once and kept on the data volume ---
ENV_FILE=/data/felony/.env
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p /data/felony
  umask 077
  cat > "$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
IMAGE=ghcr.io/${GITHUB_REPO,,}
TAG=latest
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ADMIN_TOKEN=$(openssl rand -hex 24)
IP_SALT=$(openssl rand -hex 24)
EOF
  umask 022
fi

# --- app ---
if [ ! -d /opt/felony/src/.git ]; then
  mkdir -p /opt/felony
  git clone "https://github.com/$GITHUB_REPO.git" /opt/felony/src
fi
/opt/felony/src/deploy/deploy.sh latest
