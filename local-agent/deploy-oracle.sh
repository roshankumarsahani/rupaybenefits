#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash local-agent/deploy-oracle.sh rupay.roshankumar.info.np"
  exit 2
fi
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "DOMAIN must be a hostname such as rupay.example.com."
  exit 2
fi
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) ;;
  *) echo "Unsupported CPU architecture: $ARCH"; exit 2 ;;
esac
if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 2
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/rupay-select-agent"
IMAGE="localhost/rupay-select-agent:1.1.1"

command -v dnf >/dev/null || { echo "This installer expects Oracle Linux."; exit 2; }
if ! grep -q 'Oracle Linux' /etc/os-release; then
  echo "This installer is intended for Oracle Linux 9."
  exit 2
fi

RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if (( RAM_MB < 1800 )); then
  echo "WARNING: This VM has about ${RAM_MB} MiB RAM."
  echo "The companion is configured for one browser session and may be slow or restart under heavy pages."
  echo "A VM with at least 2 GiB RAM is recommended for reliable Chromium use."
fi

echo "Installing Podman tools..."
dnf install -y container-tools

install -d -m 0755 "$APP_DIR"
install -d -m 0700 "$APP_DIR/data"
install -d -m 0755 "$APP_DIR/caddy-data" "$APP_DIR/caddy-config"
install -m 0644 "$REPO_DIR/local-agent/deploy/seccomp_profile.json" "$APP_DIR/seccomp_profile.json"
install -m 0644 "$REPO_DIR/local-agent/deploy/Caddyfile" "$APP_DIR/Caddyfile"
chown -R 1000:1000 "$APP_DIR/data"

echo "Building the Playwright browser container for $ARCH..."
podman build -f "$REPO_DIR/local-agent/Containerfile" -t "$IMAGE" "$REPO_DIR"

cat > /etc/systemd/system/rupay-select-agent.service <<EOF
[Unit]
Description=RuPay Select headless browser agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm -f rupay-select-agent
ExecStart=/usr/bin/podman run --name rupay-select-agent --rm --init --shm-size=256m --memory=700m --memory-swap=1400m --pids-limit=256 --user pwuser --security-opt seccomp=$APP_DIR/seccomp_profile.json -p 127.0.0.1:3939:3939 -v $APP_DIR/data:/app/local-agent/.data:Z -e NODE_ENV=production -e PORT=3939 -e BIND_HOST=0.0.0.0 -e AGENT_AUTH_MODE=firebase -e FIREBASE_PROJECT_ID=rupay-benefits $IMAGE
ExecStop=/usr/bin/podman stop --time 25 rupay-select-agent
ExecStopPost=-/usr/bin/podman rm -f rupay-select-agent
Restart=on-failure
RestartSec=8
TimeoutStopSec=40

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/rupay-select-caddy.service <<EOF
[Unit]
Description=RuPay Select HTTPS reverse proxy
Wants=network-online.target
After=network-online.target rupay-select-agent.service
Requires=rupay-select-agent.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm -f rupay-select-caddy
ExecStart=/usr/bin/podman run --name rupay-select-caddy --rm --network host -e DOMAIN=$DOMAIN -v $APP_DIR/Caddyfile:/etc/caddy/Caddyfile:ro,Z -v $APP_DIR/caddy-data:/data:Z -v $APP_DIR/caddy-config:/config:Z docker.io/library/caddy:2-alpine
ExecStop=/usr/bin/podman stop --time 25 rupay-select-caddy
ExecStopPost=-/usr/bin/podman rm -f rupay-select-caddy
Restart=on-failure
RestartSec=8
TimeoutStopSec=40

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rupay-select-agent.service
systemctl enable --now rupay-select-caddy.service

if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --reload
fi

echo
echo "RuPay Select services installed."
echo "Agent health (local only):"
sleep 3
curl --fail --silent http://127.0.0.1:3939/api/agent/health || true
echo
echo "HTTPS address: https://$DOMAIN"
echo
echo "Required external setup:"
echo "  1) Allow inbound TCP 80 and 443 in the OCI VCN Security List / NSG."
echo "  2) Add $DOMAIN to Firebase Authentication > Authorized domains."
echo "  3) Publish this branch's firestore.rules in Firebase Console."
echo "  4) Keep port 3939 private; only Caddy on 80/443 is public."
echo "  5) Existing WireGuard UDP 51820 is not changed by this installer."
