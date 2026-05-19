#!/usr/bin/env bash
# Build & push backend + frontend Docker images to AWS ECR, then deploy.
#
# Pipeline:
#   1. npm run test:all       (skip with SKIP_TESTS=1)
#   2. aws ecr login
#   3. docker compose build   (reads repo-root .env for build args)
#   4. docker tag for ECR
#   5. docker push (parallel)
#   6. terraform apply        (interactive -- you type "yes"; skip with SKIP_TERRAFORM=1)
#
# Required env (in infra/docker/.env or shell):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
#   AWS_ACCOUNT_ID, BACKEND_REPO, FRONTEND_REPO
#
# Optional env:
#   AWS_SESSION_TOKEN, IMAGE_TAG (default: latest), ECR_HOST,
#   SKIP_TESTS=1, SKIP_TERRAFORM=1, COMPOSE_FILE (default: docker-compose.yml),
#   TF_DIR (default: infra/aws)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"; set +a
fi

log()  { printf '\033[1;36m[%s]\033[0m %s\n' "$1" "$2"; }
fail() { printf '\033[1;31m[%s]\033[0m %s\n' "$1" "$2" >&2; }

require_env() {
  local missing=()
  for v in "$@"; do
    [[ -z "${!v:-}" ]] && missing+=("$v")
  done
  if (( ${#missing[@]} > 0 )); then
    fail "env" "missing required: ${missing[*]}"
    printf '   set them in your shell or in %s/.env\n' "$SCRIPT_DIR" >&2
    exit 64
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { fail "deps" "missing $1"; exit 127; }
}

require_cmd aws
require_cmd docker
require_cmd npm

require_env AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION \
            AWS_ACCOUNT_ID BACKEND_REPO FRONTEND_REPO

IMAGE_TAG="${IMAGE_TAG:-latest}"
ECR_HOST="${ECR_HOST:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# ---------- 0. derive immutable version tag ----------
# Format: v<YYYY-MM-DD>-<git-short-sha>[-dirty]
# When the operator passes IMAGE_TAG explicitly (something other than the
# default "latest"), respect it as the version tag — useful for rebuilding
# a known tag after a force-pull.
if [[ "$IMAGE_TAG" == "latest" ]]; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
  GIT_DATE="$(date -u +%Y-%m-%d)"
  GIT_DIRTY=""
  if ! git -C "$REPO_ROOT" diff-index --quiet HEAD -- 2>/dev/null; then
    GIT_DIRTY="-dirty"
  fi
  VERSION_TAG="v${GIT_DATE}-${GIT_SHA}${GIT_DIRTY}"
else
  VERSION_TAG="$IMAGE_TAG"
fi
log "version" "tag for this build: $VERSION_TAG"
[[ "$VERSION_TAG" == *-dirty ]] && \
  log "version" "WARNING: working tree is dirty — versioned tag is not reproducible from git alone"

cd "$REPO_ROOT"

# ---------- 1. tests ----------
if [[ "${SKIP_TESTS:-}" == "1" ]]; then
  log "test" "SKIP_TESTS=1 -- skipping npm run test:all"
else
  log "test" "running npm run test:all (must pass before build/push)"
  if ! npm run test:all; then
    fail "test" "npm run test:all failed -- aborting"
    exit 1
  fi
  log "test" "all tests passed"
fi

# ---------- 2. ECR login ----------
log "ecr" "logging in to $ECR_HOST"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST" >/dev/null
log "ecr" "logged in"

# ---------- 3. compose build ----------
# Compose auto-reads ./.env for build args (Stripe/Supabase/Encryption keys).
# Outputs local images: llmhub-backend:latest, llmhub-frontend:latest
log "build" "docker compose -f $COMPOSE_FILE build"
docker compose -f "$COMPOSE_FILE" build

# ---------- 4. tag for ECR ----------
# Tag with BOTH the immutable version (canonical, what prod runs) and :latest
# (mutable pointer for local-dev convenience and rollback fallback).
log "tag"  "tagging images for $ECR_HOST (version=$VERSION_TAG + latest)"
docker tag "llmhub-backend:latest"  "${ECR_HOST}/${BACKEND_REPO}:${VERSION_TAG}"
docker tag "llmhub-backend:latest"  "${ECR_HOST}/${BACKEND_REPO}:latest"
docker tag "llmhub-frontend:latest" "${ECR_HOST}/${FRONTEND_REPO}:${VERSION_TAG}"
docker tag "llmhub-frontend:latest" "${ECR_HOST}/${FRONTEND_REPO}:latest"

# ---------- 5. push (parallel) ----------
# Push four refs total: backend{version,latest} + frontend{version,latest}.
# After the first push of a given digest, the second push of the same digest
# under a different tag is a manifest-only push (~ms), so this is essentially
# free relative to the data push.
log "push" "pushing 4 refs in parallel"
docker push "${ECR_HOST}/${BACKEND_REPO}:${VERSION_TAG}"  & BE_VPID=$!
docker push "${ECR_HOST}/${BACKEND_REPO}:latest"          & BE_LPID=$!
docker push "${ECR_HOST}/${FRONTEND_REPO}:${VERSION_TAG}" & FE_VPID=$!
docker push "${ECR_HOST}/${FRONTEND_REPO}:latest"         & FE_LPID=$!

PUSH_RC=0
wait "$BE_VPID" || { fail "backend"  "versioned push failed (rc=$?)"; PUSH_RC=1; }
wait "$BE_LPID" || { fail "backend"  ":latest push failed (rc=$?)"; PUSH_RC=1; }
wait "$FE_VPID" || { fail "frontend" "versioned push failed (rc=$?)"; PUSH_RC=1; }
wait "$FE_LPID" || { fail "frontend" ":latest push failed (rc=$?)"; PUSH_RC=1; }
[[ $PUSH_RC -ne 0 ]] && exit 1

log "push" "$ECR_HOST/$BACKEND_REPO:$VERSION_TAG  (+ :latest)"
log "push" "$ECR_HOST/$FRONTEND_REPO:$VERSION_TAG (+ :latest)"

# ---------- 5b. update Terraform image manifest + deploy log ----------
# versions.auto.tfvars overrides the defaults in terraform.tfvars.  Writing
# the FULL URI:tag string means terraform diffs the exact tag, which forces
# ECS to register a new task-def revision and trigger a rolling deploy —
# without this, :latest tag string is identical between deploys and the
# `force_new_deployment = true` flag in ecs.tf is decorative.
VERSIONS_FILE="$REPO_ROOT/infra/aws/versions.auto.tfvars"
log "tfvars" "writing $VERSIONS_FILE"
cat > "$VERSIONS_FILE" <<EOF
# =============================================================================
# Image-tag manifest — auto-generated by infra/docker/build-and-push.sh
# (last run: $(date -u +%Y-%m-%dT%H:%M:%SZ) by $(whoami 2>/dev/null || echo unknown)).
# Do not hand-edit during a deploy.  See infra/docker/rollback.sh for rollback.
# =============================================================================
frontend_image = "${ECR_HOST}/${FRONTEND_REPO}:${VERSION_TAG}"
backend_image  = "${ECR_HOST}/${BACKEND_REPO}:${VERSION_TAG}"
EOF

DEPLOY_LOG="$SCRIPT_DIR/deployments.log"
DEPLOY_BY="$(whoami 2>/dev/null || echo unknown)"
DEPLOY_MSG="$(git -C "$REPO_ROOT" log -1 --pretty=format:'%s' 2>/dev/null || echo '')"
DEPLOY_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Tab-separated: timestamp \t action \t tag \t user \t git-message
printf '%s\t%s\t%s\t%s\t%s\n' \
  "$DEPLOY_TS" "deploy" "$VERSION_TAG" "$DEPLOY_BY" "$DEPLOY_MSG" \
  >> "$DEPLOY_LOG"
log "audit" "appended deploy entry to $DEPLOY_LOG"

# ---------- 6. terraform apply ----------
TF_DIR="${TF_DIR:-infra/aws}"
if [[ "${SKIP_TERRAFORM:-}" == "1" ]]; then
  log "tf" "SKIP_TERRAFORM=1 -- skipping terraform apply"
else
  require_cmd terraform
  if [[ ! -d "$REPO_ROOT/$TF_DIR" ]]; then
    fail "tf" "$TF_DIR not found in repo root"
    exit 1
  fi
  log "tf" "running 'terraform apply' in $TF_DIR (you will be prompted to type 'yes')"
  TF_RC=0
  ( cd "$REPO_ROOT/$TF_DIR" && terraform apply ) || TF_RC=$?
  if [[ $TF_RC -ne 0 ]]; then
    fail "tf" "terraform apply failed (rc=$TF_RC) -- images already pushed to ECR"
    exit 1
  fi
  log "tf" "terraform apply completed"
fi

log "done" "build, push, and terraform apply complete"
