#!/usr/bin/env bash
# Avis Watcher — one-shot setup + block-test for a Hostinger KVM2 (Ubuntu) VPS.
# Run from the repo root:  bash deploy/kvm2-setup.sh
set -e
cd "$(dirname "$0")/.."

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> Installing Node 20 + git ..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
$SUDO apt-get install -y git

echo "==> Installing npm deps ..."
npm install

echo "==> Installing Chromium + system libraries for Playwright ..."
npx playwright install --with-deps chromium

# --- secrets ---
if [ ! -f .env ]; then
  echo "==> No .env found — enter your secrets:"
  read -rp "  TELEGRAM_BOT_TOKEN: " TG
  read -rp "  TELEGRAM_CHAT_ID:   " CH
  read -rp "  AWD_CODE [A359824]: " AWD; AWD=${AWD:-A359824}
  cat > .env <<EOF
PROVIDER=avis
NOTIFIER=telegram
TELEGRAM_BOT_TOKEN=$TG
TELEGRAM_CHAT_ID=$CH
AWD_CODE=$AWD
# Uncomment + set if you later add a residential proxy to beat PerimeterX:
# PROXY_URL=http://user:pass@host:port
EOF
  echo "==> Wrote .env"
fi

echo ""
echo "==> Running ONE test check now. Watch your Telegram for the verdict..."
echo "    (each location loads a real browser, so this takes a few minutes)"
node src/index.js --once --report

cat <<'NOTE'

------------------------------------------------------------------
RESULT GUIDE
- Telegram says "ALL ... BLOCKED (PerimeterX)"  -> a bare VPS can't read
  prices. Add a residential proxy: put PROXY_URL=... in .env and re-run.
- Telegram says "Got real prices ..."           -> it works! Turn on hourly:
      npm i -g pm2
      pm2 start src/index.js --name avis && pm2 save && pm2 startup
  (pm2 runs the built-in hourly schedule + dashboard on port 4100.)

To run a manual check anytime:   node src/index.js --once --report
------------------------------------------------------------------
NOTE
