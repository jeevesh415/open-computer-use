#!/usr/bin/env bash
# Post-deploy suite runner — Unix / Git Bash.
#
# Loads tests/post_deploy/.env, installs deps if missing, runs pytest.
# Exit code mirrors pytest's — suitable for CI gates.

set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "ERROR: tests/post_deploy/.env not found."
  echo "  cp tests/post_deploy/.env.example tests/post_deploy/.env"
  echo "  (then fill in values)"
  exit 2
fi

# Install deps the first time or if requirements has changed since.
REQ_HASH_FILE=".requirements.hash"
CURRENT_HASH=$(shasum -a 256 requirements.txt | awk '{print $1}')
if [[ ! -f "$REQ_HASH_FILE" ]] || [[ "$(cat $REQ_HASH_FILE)" != "$CURRENT_HASH" ]]; then
  echo "[run.sh] Installing post-deploy requirements..."
  python -m pip install --quiet -r requirements.txt
  echo "$CURRENT_HASH" > "$REQ_HASH_FILE"
fi

# Export .env variables so child processes pick them up.
set -o allexport
# shellcheck disable=SC1091
source .env
set +o allexport

# Pass any extra args through to pytest (-k, -x, --lf, etc.)
exec python -m pytest "$@"
