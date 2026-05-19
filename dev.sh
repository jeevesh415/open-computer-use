#!/usr/bin/env bash
# dev.sh - Run frontend (Next.js) and backend (FastAPI) together.
# Ctrl+C stops both process groups and frees ports 3000/8001.

set -m  # job control: each background job gets its own process group

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
    trap - INT TERM EXIT
    echo
    echo "[dev] Stopping servers..."

    for pid in "${PIDS[@]}"; do
        # Negative pid = whole process group (npm -> node -> next dev, etc.)
        kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    done

    sleep 1

    for pid in "${PIDS[@]}"; do
        kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    done

    # Belt-and-suspenders: free the ports if anything is still listening.
    for port in 3000 8001; do
        if command -v lsof >/dev/null 2>&1; then
            pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
            [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
        elif command -v fuser >/dev/null 2>&1; then
            fuser -k "${port}/tcp" 2>/dev/null || true
        fi
    done

    echo "[dev] Stopped."
}

trap cleanup INT TERM EXIT

VENV_PY="$ROOT/backend/venv/bin/python"
if [ ! -x "$VENV_PY" ]; then
    echo "[dev] venv missing at $VENV_PY"
    echo "[dev] Run backend/run_backend.sh once to create it, then re-run dev.sh."
    exit 1
fi

echo "[dev] Starting backend  (FastAPI on :8001)..."
(
    cd "$ROOT/backend"
    export DEBUG="${DEBUG:-true}"
    export ENVIRONMENT="${ENVIRONMENT:-development}"
    exec "$VENV_PY" main.py
) &
PIDS+=($!)

sleep 0.4

echo "[dev] Starting frontend (Next.js on :3000)..."
(
    cd "$ROOT"
    exec npm run dev
) &
PIDS+=($!)

echo
echo "[dev]  Frontend  http://localhost:3000"
echo "[dev]  Backend   http://localhost:8001"
echo "[dev]  Ctrl+C to stop both."
echo

# Wait for either to exit; the EXIT trap then tears down the rest.
wait -n
