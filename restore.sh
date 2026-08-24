#!/bin/bash
set -e

DB="$HOME/Library/Application Support/io.timekeeper.app/traildepot/data/main.db"
BACKUP_DIR="$HOME/Library/Application Support/io.timekeeper.app/local_backups"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "No backups found at: $BACKUP_DIR"
  exit 1
fi

mapfile -t BACKUPS < <(ls -t "$BACKUP_DIR"/timekeeper_*.db 2>/dev/null)

if [ ${#BACKUPS[@]} -eq 0 ]; then
  echo "No backup files found."
  exit 1
fi

echo "Available backups:"
for i in "${!BACKUPS[@]}"; do
  SIZE=$(du -h "${BACKUPS[$i]}" | cut -f1)
  NAME=$(basename "${BACKUPS[$i]}")
  echo "  $((i+1))) $NAME  ($SIZE)"
done

echo ""
read -rp "Restore which? (1-${#BACKUPS[@]}, or q to quit): " CHOICE

[[ "$CHOICE" == "q" ]] && exit 0

if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt ${#BACKUPS[@]} ]; then
  echo "Invalid choice."
  exit 1
fi

SOURCE="${BACKUPS[$((CHOICE-1))]}"

# Kill trail if running — can't restore open DB
if pgrep -x trail > /dev/null; then
  echo "Stopping trail process..."
  pkill -x trail
  sleep 1
fi

# Safety backup of current DB before overwrite
SAFETY="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).db"
if [ -f "$DB" ]; then
  cp "$DB" "$SAFETY"
  echo "Current DB saved to: $SAFETY"
fi

cp "$SOURCE" "$DB"
echo "Restored: $(basename "$SOURCE") → $DB"
echo "Restart Timekeeper to apply."
