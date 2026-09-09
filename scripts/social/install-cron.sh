#!/usr/bin/env bash
# Install the daily social cron (idempotent). Usage: bash scripts/social/install-cron.sh
# Defaults: X 00:10 UTC (08:10 北京) · Weibo 12:40 UTC (20:40 北京).
# Override with e.g. X_HOUR=1 X_MIN=5 WEIBO_HOUR=13 WEIBO_MIN=0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/social/cron-post.sh"
MARK="progmune-social"

X_MIN="${X_MIN:-10}"; X_HOUR="${X_HOUR:-0}"
WB_MIN="${WB_MIN:-40}"; WB_HOUR="${WB_HOUR:-12}"

LINE1="$X_MIN $X_HOUR * * * $WRAPPER # $MARK"
LINE2="$WB_MIN $WB_HOUR * * * $WRAPPER # $MARK"

# cron needs node on PATH; a leading env line covers both entries.
ENVLINE="PATH=$PATH"

existing="$(crontab -l 2>/dev/null || true)"
if printf '%s' "$existing" | grep -q "$MARK"; then
  echo "cron 已存在 $MARK 条目——先移除再重装（或手动 crontab -e 编辑）。"
  echo "$existing" | grep "$MARK" || true
  exit 1
fi

{ printf '%s\n' "$existing"; echo "$ENVLINE"; echo "$LINE1"; echo "$LINE2"; } | crontab -
echo "已安装："
crontab -l | grep "$MARK"
