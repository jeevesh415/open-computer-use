#!/usr/bin/env bash
# Load Apple signing + notarization credentials from .env.signing
# Mirrors sign-and-build.ps1 (the Windows / Azure equivalent).
#
# Expected variables in .env.signing:
#   CSC_NAME                       Developer ID Application common name
#                                  (cert must be in login Keychain — electron-builder
#                                  resolves it by name instead of using CSC_LINK/.p12)
#   APPLE_ID                       Apple ID email used for notarization
#   APPLE_APP_SPECIFIC_PASSWORD    App-specific password (NOT iCloud password)
#   APPLE_TEAM_ID                  10-char Team ID from developer.apple.com
#
# Lines may use plain `VAR=value` or `export VAR=value` syntax.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.signing"

if [[ ! -f "$ENV_FILE" ]]; then
    echo ".env.signing file not found at $ENV_FILE" >&2
    exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([^=#[:space:]]+)=(.*)$ ]]; then
        name="${BASH_REMATCH[2]}"
        value="${BASH_REMATCH[3]}"
        # Strip surrounding single or double quotes if present
        if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
            value="${BASH_REMATCH[1]}"
        fi
        export "$name=$value"
        echo "Set $name"
    fi
done < "$ENV_FILE"

echo ""
echo "Building, signing, and notarizing Electron app..."
npm run package:mac
