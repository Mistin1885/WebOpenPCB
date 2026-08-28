#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf '%s\n' "Usage: scripts/docker-restore.sh <backup.tar.gz>" >&2
  exit 2
fi

archive_dir="$(cd "$(dirname "$1")" && pwd)"
archive="${archive_dir}/$(basename "$1")"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${archive}" ]]; then
  printf '%s\n' "Backup not found: ${archive}" >&2
  exit 2
fi

if tar -tzf "${archive}" | awk '
  /(^\/|(^|\/)\.\.(\/|$))/ { unsafe = 1 }
  END { exit unsafe ? 0 : 1 }
'; then
  printf '%s\n' "Backup contains an unsafe path; restore refused." >&2
  exit 1
fi

cd "${repo_dir}"
was_running="$(docker compose ps --status running --quiet openpcb)"

restart() {
  if [[ -n "${was_running}" ]]; then
    docker compose up -d openpcb >/dev/null
  fi
}
trap restart EXIT

docker compose stop openpcb >/dev/null

# Make a recoverable copy before replacing the volume contents.
recovery_output="$(scripts/docker-backup.sh "${repo_dir}/backups/pre-restore")"

docker compose run --rm --no-deps --entrypoint sh openpcb -c \
  'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker compose run --rm --no-deps -T --entrypoint tar openpcb \
  -C /data -xzf - <"${archive}"
restart
trap - EXIT

printf '%s\n' "Restored ${archive}"
printf '%s\n' "${recovery_output}"
