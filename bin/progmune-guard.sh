#!/bin/bash
# Progmune Guard — Git pre-commit hook
# Ensures new .ts files are generated through Progmune (have @progmune-generated marker)
# or are in the allowlist.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

ALLOWLIST_FILE=".progmune_allowlist"
MARKER="@progmune-generated"

# Find new/staged .ts files (excluding deleted files)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep '\.ts$' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Load allowlist patterns
ALLOWLIST=""
if [ -f "$ALLOWLIST_FILE" ]; then
  ALLOWLIST=$(grep -v '^#' "$ALLOWLIST_FILE" | grep -v '^$' || true)
fi

VIOLATIONS=0

for FILE in $STAGED_FILES; do
  # Check if file is in allowlist
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

  # Check if file has @progmune-generated marker in first 5 lines
  if [ -f "$FILE" ]; then
    HEAD=$(head -5 "$FILE" 2>/dev/null || true)
    if echo "$HEAD" | grep -q "$MARKER"; then
      echo -e "  ${GREEN}✓${NC} $FILE (progmune-generated)"
      continue
    fi
  fi

  # New file without marker — VIOLATION
  echo -e "  ${RED}✗${NC} $FILE ${RED}missing @progmune-generated marker${NC}"
  VIOLATIONS=$((VIOLATIONS + 1))
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  Progmune Guard: ${VIOLATIONS} file(s) blocked${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "New TypeScript files must be generated through Progmune."
  echo "Use: progmune_execute(intent=\"...\", filePath=\"$FILE\")"
  echo ""
  echo "Or add to $ALLOWLIST_FILE:"
  echo "  echo '$FILE' >> $ALLOWLIST_FILE"
  echo ""
  exit 1
fi

exit 0
