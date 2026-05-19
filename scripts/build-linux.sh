#!/usr/bin/env bash
# =============================================================================
# Coasty — Linux build helper
#
# Cross-builds the Linux distribution from any host that has Docker, OR
# builds natively when run from a Linux host (or WSL).
#
# Usage (from repo root):
#   bash scripts/build-linux.sh             # auto-detect, pick best path
#   bash scripts/build-linux.sh portable    # build only tar.gz (no Linux tools needed; works on Windows native)
#   bash scripts/build-linux.sh docker      # force Docker cross-build
#   bash scripts/build-linux.sh native      # force native (must already be on Linux)
#
# Output goes to: electron/dist/
#   Coasty Desktop-<ver>-x86_64.AppImage      ← portable, double-click to run
#   coasty-desktop_<ver>_amd64.deb            ← Debian/Ubuntu install
#   coasty-desktop-<ver>.tar.gz               ← extract + run, no deps
# =============================================================================

set -euo pipefail

# ── Locate repo root ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ELECTRON="${ROOT}/electron"

cd "${ELECTRON}"

# ── Color helpers ───────────────────────────────────────────────────────────
CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; BOLD='\033[1m'; RESET='\033[0m'
banner() { printf '\n%b%b═══════════════════════════════════════════════════════════════%b\n' "$CYAN" "$BOLD" "$RESET"; printf '%b%b  %s%b\n' "$CYAN" "$BOLD" "$1" "$RESET"; printf '%b%b═══════════════════════════════════════════════════════════════%b\n\n' "$CYAN" "$BOLD" "$RESET"; }
ok()     { printf '%b✓ %s%b\n' "$GREEN" "$1" "$RESET"; }
warn()   { printf '%b⚠ %s%b\n' "$YELLOW" "$1" "$RESET"; }
err()    { printf '%b✗ %s%b\n' "$RED" "$1" "$RESET"; }

MODE="${1:-auto}"

# ── Mode resolution ─────────────────────────────────────────────────────────
case "${MODE}" in
  auto)
    if [[ "$(uname -s 2>/dev/null)" == "Linux" ]]; then
      MODE="native"
      ok "auto: detected Linux host → native build"
    elif command -v docker >/dev/null 2>&1; then
      MODE="docker"
      ok "auto: detected Docker → cross-build via electronuserland/builder"
    else
      MODE="portable"
      warn "auto: no Linux host or Docker — falling back to portable tar.gz only"
    fi ;;
  portable|docker|native) ;;
  *) err "unknown mode: ${MODE} (expected: auto | portable | docker | native)"; exit 2 ;;
esac

# ── Build renderer/main/preload ─────────────────────────────────────────────
banner "BUILDING ELECTRON BUNDLE"
npx electron-vite build
ok "JS bundle built"

# ── Pick a build mode ───────────────────────────────────────────────────────
case "${MODE}" in
  portable)
    banner "PACKAGING — tar.gz (zero deps, builds on any host)"
    npx electron-builder --linux tar.gz
    ok "Portable tarball ready in electron/dist/"
    ;;
  native)
    banner "PACKAGING — AppImage + deb + tar.gz (native Linux)"
    if ! command -v mksquashfs >/dev/null 2>&1; then
      warn "mksquashfs not on PATH — install with: sudo apt install squashfs-tools"
    fi
    npx electron-builder --linux
    ok "All Linux artifacts ready in electron/dist/"
    ;;
  docker)
    banner "PACKAGING — AppImage + deb + tar.gz (Docker cross-build)"
    # electron-builder's official image bundles every Linux + Wine tool.
    # Mounted volumes preserve the Electron download cache between runs.
    docker run --rm \
      -e ELECTRON_CACHE="/root/.cache/electron" \
      -e ELECTRON_BUILDER_CACHE="/root/.cache/electron-builder" \
      -v "${ROOT}":/project \
      -v "${HOME}/.cache/electron:/root/.cache/electron" \
      -v "${HOME}/.cache/electron-builder:/root/.cache/electron-builder" \
      -w /project/electron \
      electronuserland/builder:wine \
      /bin/bash -c "npm install --omit=optional && npx electron-builder --linux"
    ok "All Linux artifacts ready in electron/dist/"
    ;;
esac

# ── Summary ─────────────────────────────────────────────────────────────────
banner "ARTIFACTS"
ls -lh "${ELECTRON}/dist/" 2>/dev/null | grep -E '\.(AppImage|deb|rpm|tar\.gz|zip)$' || warn "no artifacts found in dist/"

printf '\n%b%bDone.%b Linux users can now:\n' "$GREEN" "$BOLD" "$RESET"
printf '  • Double-click the .AppImage (after %bchmod +x%b) on most distros\n' "$BOLD" "$RESET"
printf '  • Run %bsudo apt install ./coasty-desktop_*.deb%b on Debian/Ubuntu\n' "$BOLD" "$RESET"
printf '  • Extract the .tar.gz and run %b./coasty-desktop%b on any distro (no deps)\n\n' "$BOLD" "$RESET"
