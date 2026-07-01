#!/usr/bin/env bash
#
# One-time import of local secret VALUES into Infisical.
#
# Run this YOURSELF, in your own terminal, after `infisical login` and
# `infisical init` (see docs/FamLink_Secrets_Runbook.md). Do NOT run this
# via an AI coding assistant / Claude Code Bash tool — command output and
# arguments become part of that session's context, which is exactly how
# the June 2026 Postgres-password + GitHub-PAT leaks happened.
#
# Usage:
#   ./scripts/secrets/import-to-infisical.sh <dev|test|prod> <path-to-env-file>
#
# Examples:
#   ./scripts/secrets/import-to-infisical.sh dev .env
#   ./scripts/secrets/import-to-infisical.sh dev .env.local
#   ./scripts/secrets/import-to-infisical.sh test apps/api/.env.test
#
# Prod has no local file with real values by design — enter prod secrets
# by hand (`infisical secrets set NAME=value --env=prod`), copying each
# value directly from the Railway dashboard.
#
# Note: this deliberately omits `--path=`. On Git Bash for Windows, MSYS
# rewrites a literal "/" argument into the Git install path before it
# reaches infisical.exe (a native Windows binary), which breaks the call
# with a 400 "Invalid secret path" error. Omitting --path uses Infisical's
# root-path default and avoids the rewrite entirely.

set -euo pipefail

ENVIRONMENT="${1:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"
ENV_FILE="${2:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "File not found: $ENV_FILE" >&2
  exit 1
fi

count=0
skipped=0
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  key="${key%$'\r'}"
  value="${value%$'\r'}"
  while [[ "$value" == *[[:space:]] ]]; do value="${value%[[:space:]]}"; done
  case "$value" in
    \"*\") value="${value%\"}"; value="${value#\"}" ;;
    \'*\') value="${value%\'}"; value="${value#\'}" ;;
  esac
  if [ -z "$value" ]; then
    echo "Skipping $key: empty value (Infisical rejects empty secrets — fill it in locally first if you need it in Infisical)" >&2
    skipped=$((skipped + 1))
    continue
  fi
  infisical secrets set "${key}=${value}" --env="$ENVIRONMENT" > /dev/null
  count=$((count + 1))
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE")

echo "Imported $count secrets into Infisical environment '$ENVIRONMENT' from $ENV_FILE (skipped $skipped empty-valued keys)."
echo "No values were printed above. Verify with: infisical secrets --env=$ENVIRONMENT"
