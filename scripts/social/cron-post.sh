#!/usr/bin/env bash
# Daily social post wrapper for cron. Posts "today's" X + Weibo pieces.
# Safe without credentials: logs the error, exits non-zero, never half-posts.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${SOCIAL_LOG:-/tmp/progmune-social.log}"
cd "$ROOT"

echo "── $(date '+%F %T') ──" >> "$LOG"
node scripts/social/publish.js x today >> "$LOG" 2>&1 || echo "[x failed]" >> "$LOG"
node scripts/social/publish.js weibo today >> "$LOG" 2>&1 || echo "[weibo failed]" >> "$LOG"
echo "── end ──" >> "$LOG"
