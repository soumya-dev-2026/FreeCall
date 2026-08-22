#!/usr/bin/env bash
# One command to get FreeCall running locally: installs if needed, starts the
# signaling server and the web client, and stops both on Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"

printf '\n  FreeCall\n  --------\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't on your PATH. Install Node 18+ from https://nodejs.org"
  exit 1
fi

major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "$major" -lt 18 ]; then
  echo "  Node $(node -v) is too old; this needs 18 or newer."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  Installing dependencies. First run only — this takes a few minutes."
  echo
  npm install
  echo
fi

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "  Created server/.env from the example. Defaults are fine locally."
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "  Shutting down..."
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "  Starting the signaling server on http://localhost:4000"
npm run dev:server &
pids+=($!)

printf '  Waiting for it to answer'
for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 2 http://localhost:4000/health >/dev/null 2>&1; then
    printf ' — up\n'
    break
  fi
  printf '.'
  sleep 1
done
echo

echo "  Starting the web client on http://localhost:5173"
npm run dev:web &
pids+=($!)

sleep 4
url=http://localhost:5173
# Only macOS `open` means "open in a browser"; on Linux it's a different tool.
if [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
  open "$url" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$url" >/dev/null 2>&1 || true
fi

cat <<'EOF'

  Sign in as alice, bob or carol — the password is: password

  To place a real call you need two sessions: open a second browser profile
  (or a private window) and sign in as a different user.

  The mobile app is separate and needs a native build:
    npm --prefix mobile install
    cd mobile && npx expo prebuild && npm run ios     # or: npm run android

  Ctrl-C stops both servers.
EOF

wait
