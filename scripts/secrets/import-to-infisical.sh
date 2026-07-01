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
# by hand (`infisical secrets set NAME=value --env=prod --path="/"`),
# copying each value directly from the Railway dashboard.

set -euo pipefail

ENVIRONMENT="${1:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"
ENV_FILE="${2:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "File not found: $ENV_FILE" >&2
  exit 1
fi

count=0
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  key="${key%$'\r'}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value%\"}"; value="${value#\"}" ;;
    \'*\') value="${value%\'}"; value="${value#\'}" ;;
  esac
  infisical secrets set "${key}=${value}" --env="$ENVIRONMENT" --path="/" > /dev/null
  count=$((count + 1))
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE")

echo "Imported $count secrets into Infisical environment '$ENVIRONMENT' from $ENV_FILE."
echo "No values were printed above. Verify with: infisical secrets --env=$ENVIRONMENT"
