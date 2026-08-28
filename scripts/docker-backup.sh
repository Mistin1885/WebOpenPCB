#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${1:-${repo_dir}/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${backup_dir}/openpcb-${timestamp}.tar.gz"

mkdir -p "${backup_dir}"
cd "${repo_dir}"

was_running="$(docker compose ps --status running --quiet openpcb)"
if [[ -n "${was_running}" ]]; then
  docker compose stop openpcb >/dev/null
fi

restart() {
  if [[ -n "${was_running}" ]]; then
    docker compose start openpcb >/dev/null
  fi
}
trap restart EXIT

docker compose run --rm --no-deps --entrypoint tar openpcb \
  -C /data -czf - . >"${archive}"

printf '%s\n' "Backup written to ${archive}"
