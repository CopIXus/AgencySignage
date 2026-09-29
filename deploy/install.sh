#!/bin/bash
# Install Agency Signage on the Raspberry Pi that hosts the site.
# From the internet:
#   curl -fsSL https://raw.githubusercontent.com/CopIXus/AgencySignage/main/deploy/install.sh | sudo bash
# The script asks for the admin password on first install. It is not stored in the service file.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: curl -fsSL https://raw.githubusercontent.com/CopIXus/AgencySignage/main/deploy/install.sh | sudo bash"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git avahi-daemon openssl rsync
if ! command -v node >/dev/null 2>&1 || ! node -e "import('node:sqlite')" >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

TARGET=/opt/agency-signage
REPO=https://github.com/CopIXus/AgencySignage.git
SOURCE=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/server/index.js" ]; then
  SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [ -n "$SOURCE" ] && [ "$SOURCE" != "$TARGET" ]; then
  mkdir -p "$TARGET"
  rsync -a --delete --exclude data --exclude node_modules --exclude .git "$SOURCE/" "$TARGET/"
else
  STAGING="$(mktemp -d)"
  git clone --depth 1 "$REPO" "$STAGING/src"
  mkdir -p "$TARGET"
  rsync -a --delete --exclude data --exclude node_modules --exclude .git "$STAGING/src/" "$TARGET/"
  rm -rf "$STAGING"
fi

mkdir -p "$TARGET/data"
chmod 700 "$TARGET/data"

if [ ! -f "$TARGET/data/signage.db" ]; then
  if [ -z "${SIGNAGE_ADMIN_PASSWORD:-}" ]; then
    if [ ! -r /dev/tty ]; then
      echo "No terminal found. Run again with SIGNAGE_ADMIN_PASSWORD set to at least 8 characters."
      exit 1
    fi
    while true; do
      read -r -s -p "Choose the admin password (at least 8 characters): " SIGNAGE_ADMIN_PASSWORD < /dev/tty
      echo
      read -r -s -p "Confirm password: " CONFIRM < /dev/tty
      echo
      if [ "$SIGNAGE_ADMIN_PASSWORD" = "$CONFIRM" ] && [ "${#SIGNAGE_ADMIN_PASSWORD}" -ge 8 ]; then
        break
      fi
      echo "Passwords must match and be at least 8 characters."
    done
    unset CONFIRM
  fi
  if [ "${#SIGNAGE_ADMIN_PASSWORD}" -lt 8 ]; then
    echo "The admin password must be at least 8 characters."
    exit 1
  fi
  printf '%s' "$SIGNAGE_ADMIN_PASSWORD" > "$TARGET/data/setup-password.txt"
  chmod 600 "$TARGET/data/setup-password.txt"
  unset SIGNAGE_ADMIN_PASSWORD
fi

NODE="$(command -v node)"
cat > /etc/systemd/system/signage.service <<UNIT
[Unit]
Description=Agency signage
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$TARGET
Environment=NODE_ENV=production
ExecStart=$NODE server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now signage.service
systemctl restart signage.service
if command -v avahi-set-host-name >/dev/null 2>&1; then
  avahi-set-host-name signage || true
fi

echo
echo "Agency Signage is running."
echo "Admin:   https://signage.local:8443/admin"
echo "Setup:   https://signage.local:8443/setup"
echo "Username: admin"
if [ -f "$TARGET/data/initial-password.txt" ]; then
  echo "A generated password was saved in $TARGET/data/initial-password.txt"
else
  echo "Sign in with the password you just chose."
fi
echo "Reset later with: node $TARGET/server/reset-password.js admin 'new-password'"
