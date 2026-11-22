#!/usr/bin/env bash
set -euo pipefail

DOMAIN="$1"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash local-agent/deploy-oracle.sh benefits.example.com"
  exit 2
fi
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "DOMAIN must be a hostname such as benefits.example.com."
  exit 2
fi
if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "This deployment is pinned for Oracle A1 ARM64. Detected: $(uname -m)"
  echo "For x86_64, change the Playwright image tag in local-agent/Containerfile."
  exit 2
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 2
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/rupay-select-agent"
IMAGE="localhost/rupay-select-agent:1.1.0"

command -v dnf >/dev/null || { echo "This installer expects Oracle Linux."; exit 2; }
dnf install -y container-tools

install -d -m 0755 "$APP_DIR"
install -d -m 0700 "$APP_DIR/data"
install -d -m 0755 "$APP_DIR/caddy-data" "$APP_DIR/caddy-config"
install -m 0644 "$REPO_DIR/local-agent/deploy/seccomp_profile.json" "$APP_DIR/seccomp_profile.json"
install -m 0644 "$REPO_DIR/local-agent/deploy/Caddyfile" "$APP_DIR/Caddyfile"

# The official Playwright image provides a non-root pwuser account (UID 1000).
chown -R 1000:1000 "$APP_DIR/data"

echo "Building the ARM64 Playwright container..."
podman build -f "$REPO_DIR/local-agent/Containerfile" -t "$IMAGE" "$REPO_DIR"

cat > /etc/systemd/system/rupay-select-agent.service <<EOF
[Unit]
Description=RuPay Select headless browser agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm -f rupay-select-agent
ExecStart=/usr/bin/podman run --name rupay-select-agent --rm --init --shm-size=1g --user pwuser --security-opt seccomp=$APP_DIR/seccomp_profile.json -p 127.0.0.1:3939:3939 -v $APP_DIR/data:/app/local-agent/.data:Z -e NODE_ENV=production -e PORT=3939 -e BIND_HOST=0.0.0.0 -e AGENT_AUTH_MODE=firebase -e FIREBASE_PROJECT_ID=rupay-benefits $IMAGE
ExecStop=/usr/bin/podman stop --time 25 rupay-select-agent
ExecStopPost=-/usr/bin/podman rm -f rupay-select-agent
Restart=always
RestartSec=5
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
Restart=always
RestartSec=5
TimeoutStopSec=40

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rupay-select-agent.service
systemctl enable --now rupay-select-caddy.service

echo
echo "RuPay Select Oracle services have been installed."
echo "Agent health (local only):"
sleep 3
curl --fail --silent http://127.0.0.1:3939/api/agent/health || true
echo
echo "HTTPS address: https://$DOMAIN"
echo
echo "Before opening the site, make sure:"
echo "  1) DNS A record for $DOMAIN points to this VM public IP."
echo "  2) OCI VCN security list / NSG allows inbound TCP 80 and 443."
echo "  3) VM firewall allows TCP 80 and 443 (preserve existing WireGuard rules)."
echo "  4) Add $DOMAIN to Firebase Authentication > Authorized domains."
echo "  5) Publish this branch's firestore.rules in Firebase Console."
echo "Do NOT expose port 3939 publicly; it is bound to host loopback only."
