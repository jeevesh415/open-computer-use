#!/usr/bin/env bash
# =============================================================================
# Coasty — Pre-Deployment Test Suite
#
# Runs all tests across frontend, backend, and electron layers.
# Exit code is non-zero if ANY suite fails.
#
# Usage:
#   bash scripts/run-all-tests.sh          # run all
#   bash scripts/run-all-tests.sh frontend  # run only frontend
#   bash scripts/run-all-tests.sh backend   # run only backend
#   bash scripts/run-all-tests.sh electron  # run only electron
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  $1${NC}"
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""
}

run_suite() {
  local name="$1"
  shift
  local start_time=$(date +%s)

  echo -e "${YELLOW}▶ Running ${name}...${NC}"
  if "$@" 2>&1; then
    local elapsed=$(( $(date +%s) - start_time ))
    echo -e "${GREEN}✓ ${name} passed (${elapsed}s)${NC}"
    RESULTS+=("${GREEN}✓ ${name} (${elapsed}s)${NC}")
  else
    local elapsed=$(( $(date +%s) - start_time ))
    echo -e "${RED}✗ ${name} FAILED (${elapsed}s)${NC}"
    RESULTS+=("${RED}✗ ${name} FAILED (${elapsed}s)${NC}")
    FAILED=1
  fi
  echo ""
}

FILTER="${1:-all}"

# -----------------------------------------------
# 1. Frontend Tests (Vitest)
# -----------------------------------------------
if [[ "$FILTER" == "all" || "$FILTER" == "frontend" ]]; then
  banner "FRONTEND TESTS (Vitest)"
  cd "$ROOT_DIR"
  run_suite "Frontend Unit Tests" npx vitest run --reporter=verbose
fi

# -----------------------------------------------
# 2. Backend Tests (pytest)
# -----------------------------------------------
if [[ "$FILTER" == "all" || "$FILTER" == "backend" ]]; then
  banner "BACKEND TESTS (pytest)"
  cd "$ROOT_DIR/backend"

  # Activate venv if it exists
  if [[ -f "venv/Scripts/activate" ]]; then
    source venv/Scripts/activate
  elif [[ -f "venv/bin/activate" ]]; then
    source venv/bin/activate
  fi

  run_suite "Backend Unit & Integration Tests" python -m pytest tests/ -v --tb=short
fi

# -----------------------------------------------
# 3. Electron Tests (Vitest)
# -----------------------------------------------
if [[ "$FILTER" == "all" || "$FILTER" == "electron" ]]; then
  banner "ELECTRON TESTS (Vitest)"
  cd "$ROOT_DIR/electron"
  run_suite "Electron Unit Tests" npx vitest run --reporter=verbose
fi

# -----------------------------------------------
# 4. Type Checking (TypeScript)
# -----------------------------------------------
if [[ "$FILTER" == "all" || "$FILTER" == "typecheck" ]]; then
  banner "TYPE CHECKING"
  cd "$ROOT_DIR"
  run_suite "TypeScript Type Check" npx tsc --noEmit
fi

# -----------------------------------------------
# Summary
# -----------------------------------------------
banner "TEST RESULTS SUMMARY"
for r in "${RESULTS[@]}"; do
  echo -e "  $r"
done
echo ""

if [[ $FAILED -ne 0 ]]; then
  echo -e "${RED}${BOLD}Some test suites failed. Fix issues before deploying.${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}All test suites passed! Ready for deployment.${NC}"
  exit 0
fi
