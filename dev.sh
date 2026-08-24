#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill only Timekeeper's own stale processes by name
pkill -x timekeeper 2>/dev/null || true
pkill -f "trail run" 2>/dev/null || true

# Wait for TrailBase port 47400 to be released (up to 4 seconds)
for i in $(seq 1 8); do
  lsof -ti :47400 >/dev/null 2>&1 || break
  sleep 0.5
done
if lsof -ti :47400 >/dev/null 2>&1; then
  echo "[dev] WARNING: Port 47400 still occupied by foreign process — TrailBase may not start"
fi

# Kill our own Vite instance if running on our preferred port
lsof -ti :47173 | xargs kill -9 2>/dev/null || true
sleep 0.3

# Find a free Vite port starting at 47173
VITE_PORT=47173
while lsof -ti :$VITE_PORT >/dev/null 2>&1; do
  echo "[dev] Port $VITE_PORT occupied by foreign process, trying $((VITE_PORT + 1))..."
  VITE_PORT=$((VITE_PORT + 1))
done

# If port changed, update vite.config.js and tauri.conf.json
if [ "$VITE_PORT" != "47173" ]; then
  echo "[dev] Using Vite port $VITE_PORT"
  python3 - <<EOF
import re
with open('$SCRIPT_DIR/frontend/vite.config.js') as f: t = f.read()
t = re.sub(r'port: \d+', 'port: $VITE_PORT', t)
with open('$SCRIPT_DIR/frontend/vite.config.js', 'w') as f: f.write(t)
EOF
  python3 - <<EOF
import json
with open('$SCRIPT_DIR/src-tauri/tauri.conf.json') as f: d = json.load(f)
d['build']['devUrl'] = 'http://localhost:$VITE_PORT'
with open('$SCRIPT_DIR/src-tauri/tauri.conf.json', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
EOF
fi

LOG="$HOME/Library/Logs/timekeeper-dev.log"
echo "=== $(date) [vite: $VITE_PORT, trail: 47400] ===" >> "$LOG"

cd "$SCRIPT_DIR/src-tauri"
cargo tauri dev 2>&1 | tee -a "$LOG"

# Restore default Vite port in configs after exit
if [ "$VITE_PORT" != "47173" ]; then
  python3 - <<EOF
import re
with open('$SCRIPT_DIR/frontend/vite.config.js') as f: t = f.read()
t = re.sub(r'port: \d+', 'port: 47173', t)
with open('$SCRIPT_DIR/frontend/vite.config.js', 'w') as f: f.write(t)
EOF
  python3 - <<EOF
import json
with open('$SCRIPT_DIR/src-tauri/tauri.conf.json') as f: d = json.load(f)
d['build']['devUrl'] = 'http://localhost:47173'
with open('$SCRIPT_DIR/src-tauri/tauri.conf.json', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
EOF
fi
