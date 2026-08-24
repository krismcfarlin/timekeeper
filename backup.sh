#!/bin/bash
set -e

DB="$HOME/Library/Application Support/io.timekeeper.app/traildepot/data/main.db"
BACKUP_DIR="$HOME/Library/Application Support/io.timekeeper.app/local_backups"
mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB" ]; then
  echo "ERROR: DB not found at: $DB"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/timekeeper_$TIMESTAMP.db"

# Use sqlite3 backup command — safe even if DB is open
sqlite3 "$DB" ".backup '$DEST'"

SIZE=$(du -h "$DEST" | cut -f1)
echo "Backup saved: $DEST ($SIZE)"

# Keep last 30 local backups
cd "$BACKUP_DIR"
ls -t timekeeper_*.db 2>/dev/null | tail -n +31 | xargs rm -f
echo "Local backups kept: $(ls timekeeper_*.db 2>/dev/null | wc -l | tr -d ' ')"
