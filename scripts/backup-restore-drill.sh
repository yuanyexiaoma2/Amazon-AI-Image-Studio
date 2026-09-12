#!/usr/bin/env bash
# W8-05 stub — backup/restore drill helpers (Local/Staging). No Production keys.
set -euo pipefail
CMD="${1:-help}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR:-./tmp/backups}"
mkdir -p "$OUT_DIR"

case "$CMD" in
  dump)
    : "${DATABASE_URL:?DATABASE_URL required}"
    FILE="$OUT_DIR/studio-$STAMP.dump"
    echo "pg_dump → $FILE"
    pg_dump "$DATABASE_URL" --format=custom --file="$FILE"
    echo "OK $FILE"
    ;;
  restore-scratch)
    : "${DATABASE_URL:?DATABASE_URL required}"
    : "${2:?usage: restore-scratch <dump-file>}"
    echo "Restore into scratch DB is environment-specific; verify target is NOT Production."
    echo "Example: pg_restore --clean --if-exists --dbname=\"\$RESTORE_DATABASE_URL\" $2"
    ;;
  help|*)
    echo "Usage: $0 {dump|restore-scratch <file>|help}"
    echo "See docs/runbooks/backup-restore-rollback.md"
    ;;
esac
