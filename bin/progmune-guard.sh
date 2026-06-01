#!/bin/bash
# Progmune Guard — Git pre-commit hook (Phase 6E: Route Enforcement)
#
# PROGMUNE_ENFORCE=warn  → warning only, commit allowed (default)
# PROGMUNE_ENFORCE=block → reject commits with unmarked .ts files

set -e

ALLOWLIST_FILE=".progmune_allowlist"
MARKER="@progmune-generated"
ENFORCE="${PROGMUNE_ENFORCE:-warn}"

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep '\.ts$' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Load allowlist
ALLOWLIST=""
if [ -f "$ALLOWLIST_FILE" ]; then
  ALLOWLIST=$(grep -v '^#' "$ALLOWLIST_FILE" | grep -v '^$' || true)
fi

VIOLATIONS=0

for FILE in $STAGED_FILES; do
  # Check allowlist
  ALLOWED=0
  if [ -n "$ALLOWLIST" ]; then
    while IFS= read -r pattern; do
      if echo "$FILE" | grep -qE "$pattern"; then
        ALLOWED=1
        break
      fi
    done <<< "$ALLOWLIST"
  fi

  if [ "$ALLOWED" -eq 1 ]; then
    continue
  fi

  # Check marker
  if [ -f "$FILE" ]; then
    HEAD=$(head -5 "$FILE" 2>/dev/null || true)
    if echo "$HEAD" | grep -q "$MARKER"; then
      echo "  [progmune] OK: $FILE"
      continue
    fi
  fi

  echo "  [progmune] MISSING: $FILE"
  VIOLATIONS=$((VIOLATIONS + 1))
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "=============================================="
  echo "  Progmune: $VIOLATIONS file(s) without marker"
  echo "=============================================="
  echo ""
  echo "  Generate via: progmune_execute(intent=..., filePath=...)"
  echo "  Allowlist:    echo 'pattern' >> $ALLOWLIST_FILE"
  echo ""

  if [ "$ENFORCE" = "block" ]; then
    echo "  PROGMUNE_ENFORCE=block — commit rejected."
    exit 1
  fi

  echo "  PROGMUNE_ENFORCE=warn — commit allowed."
  echo "  Set PROGMUNE_ENFORCE=block to enforce."
fi

exit 0
