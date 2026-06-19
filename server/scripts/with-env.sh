#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd -- "$script_dir/.." && pwd)"
repo_root="$(cd -- "$server_dir/.." && pwd)"

for env_file in "$repo_root/.env" "$server_dir/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

exec "$@"
