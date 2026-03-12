#!/usr/bin/env bash
set -e

PB_VERSION="0.22.4"
PB_DIR="./pocketbase"
PB_BIN="$PB_DIR/pocketbase"
PB_DATA="./pb_data"
PB_URL="http://127.0.0.1:8090"

echo "==> Timekeeper startup"

# --- Download PocketBase if needed ---
if [ ! -f "$PB_BIN" ]; then
  echo "==> Downloading PocketBase v$PB_VERSION..."
  mkdir -p "$PB_DIR"
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi
  if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi
  ZIP_NAME="pocketbase_${PB_VERSION}_${OS}_${ARCH}.zip"
  curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${ZIP_NAME}" -o "/tmp/pb.zip"
  unzip -o /tmp/pb.zip pocketbase -d "$PB_DIR"
  chmod +x "$PB_BIN"
  echo "==> PocketBase downloaded."
fi

# --- Start PocketBase ---
echo "==> Starting PocketBase..."
"$PB_BIN" serve --dir="$PB_DATA" &
PB_PID=$!

# --- Wait for PocketBase to be ready ---
echo -n "==> Waiting for PocketBase..."
for i in $(seq 1 30); do
  if curl -sf "$PB_URL/api/health" > /dev/null 2>&1; then
    echo " ready."
    break
  fi
  sleep 0.5
  echo -n "."
done

# --- Seed superadmin ---
echo "==> Creating superadmin..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PB_URL/api/collections/_superusers/records" \
  -H "Content-Type: application/json" \
  -d '{"email":"krismcfarlin@gmail.com","password":"super1234bad","passwordConfirm":"super1234bad"}')

if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "400" ]; then
  echo "==> Admin account ready."
else
  echo "==> Admin creation returned HTTP $RESPONSE (may already exist, continuing...)"
fi

# --- Start frontend ---
echo "==> Starting frontend..."
cd frontend
npm install --silent
npm run dev &
FE_PID=$!

echo ""
echo "==> Timekeeper running!"
echo "    App:    http://localhost:5173"
echo "    Admin:  http://localhost:8090/_/"
echo ""
echo "Press Ctrl+C to stop."

# Wait and cleanup
trap "echo '==> Stopping...'; kill $PB_PID $FE_PID 2>/dev/null" INT TERM
wait
