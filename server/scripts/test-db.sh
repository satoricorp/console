#!/usr/bin/env bash
#
# Run a command (default: `bun test`) against a disposable Postgres database.
#
# The server test suite gates ~59 tests on DATABASE_URL. Without one they
# silently skip, so every database-backed path — publish intake, the GitHub
# webhook, tenant isolation, the /bookmarks compat alias — ships unverified.
# This script provisions a scratch database, applies the real migration chain
# through the server's own runMigrations(), and hands the URL to the suite.
#
#   bun run test:db              # reset the scratch DB, run the whole suite
#   bun run test:db -- test/publish.test.ts
#   bun run test:db:keep         # reuse the existing scratch DB (faster)
#
# The database is created fresh on every run so migrations 001..028 are
# exercised end to end, exactly as they would be against an empty production
# database. It is NEVER the dev database: the name must end in `_test`, and
# a hard denylist rejects the known real databases.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd -- "$script_dir/.." && pwd)"

db_name="${GX_TEST_DB_NAME:-gx_console_test}"
db_host="${PGHOST:-localhost}"
db_port="${PGPORT:-5432}"
db_user="${PGUSER:-$(whoami)}"
db_password="${PGPASSWORD:-}"

reset=1
if [[ "${1:-}" == "--keep" ]]; then
  reset=0
  shift
fi

# --- Guard rails: only ever touch an explicitly-scratch database. -----------
#
# `api` is the local dev database and holds real rows. Pointing the suite at it
# would apply the pending 028_drop_porcelain_tables.sql and DROP four populated
# tables on the first runMigrations() call.
case "$db_name" in
  api | postgres | template0 | template1 | gx | gx_cloud | gmail)
    echo "refusing to use '$db_name': that is a real database, not a scratch one" >&2
    exit 1
    ;;
esac
if [[ "$db_name" != *_test ]]; then
  echo "refusing to use '$db_name': the scratch database name must end in '_test'" >&2
  exit 1
fi

# --- Locate a Postgres server. ---------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  cat >&2 <<'EOF'
psql not found. Install a local Postgres, or start the containerized one:

  brew install postgresql@16 && brew services start postgresql@16
  # or, from the repo root:
  docker compose up -d postgres

EOF
  exit 1
fi

if ! pg_isready -h "$db_host" -p "$db_port" >/dev/null 2>&1; then
  cat >&2 <<EOF
No Postgres server accepting connections at $db_host:$db_port.

  brew services start postgresql@16
  # or, from the repo root:
  docker compose up -d postgres

EOF
  exit 1
fi

export PGHOST="$db_host"
export PGPORT="$db_port"
export PGUSER="$db_user"
[[ -n "$db_password" ]] && export PGPASSWORD="$db_password"

if [[ "$reset" == "1" ]]; then
  # Recreating the database on every run is what makes this a migration test as
  # well as a route test: the suite's runMigrations() replays 001..028 against
  # an empty schema, the same thing a fresh production deploy does.
  dropdb --if-exists "$db_name"
  createdb "$db_name"
  echo "scratch database $db_name recreated at $db_host:$db_port"
else
  createdb "$db_name" 2>/dev/null || true
  echo "reusing scratch database $db_name at $db_host:$db_port"
fi

userinfo="$db_user"
[[ -n "$db_password" ]] && userinfo="$db_user:$db_password"
export DATABASE_URL="postgres://${userinfo}@${db_host}:${db_port}/${db_name}"

cd "$server_dir"
if [[ $# -eq 0 ]]; then
  exec bun test
fi
exec "$@"
