#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

scripts/docker-backup.sh
docker compose build --pull openpcb
docker compose up -d --remove-orphans openpcb

printf '%s\n' "OpenPCB was rebuilt and restarted."
printf '%s\n' "Check status with: docker compose ps"
