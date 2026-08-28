#!/usr/bin/env bash
#
# Operator status report: users from Convex (adminStats:overview when
# deployed, otherwise Better Auth + connectedRepos), review repos from
# production RDS, plus errors from the ECS server logs.
#
# Usage:
#   scripts/status.sh              # prod Convex + production ECS logs + RDS
#   scripts/status.sh --staging    # also show staging ECS logs
#   scripts/status.sh --dev        # read the dev Convex deployment instead
#   HOURS=48 scripts/status.sh     # widen the error/review window (default 24)
#
# Needs: npx (Convex CLI auth), aws CLI credentials, psql, session-manager-plugin.
# Repos/users come from Convex connectedRepos + Better Auth, joined to
# RDS code_review_history_runs via scripts/rds.sh.

set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east-1
HOURS="${HOURS:-24}"
INCLUDE_STAGING=false
CONVEX_FLAGS=(--prod)
RDS_ENV=production
for arg in "$@"; do
  case "$arg" in
    --staging) INCLUDE_STAGING=true ;;
    --dev) CONVEX_FLAGS=(); RDS_ENV=staging ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

echo "== gx status — $(date) =="
echo

if STATS=$(npx convex run adminStats:overview ${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"} 2>/tmp/gx-status-convex.err); then
  node - <<'EOF' "$STATS"
const s = JSON.parse(process.argv[2]);
const line = (label, value) => console.log(`  ${label.padEnd(38)} ${value}`);

console.log("Users");
line("total users", s.users.total);
line("new users (last 24h)", s.users.newLast24h);
line("on trial (using free runs, not paying)", s.freeTier.onTrial);
line("signed up, never ran anything", s.freeTier.neverRan);
console.log();

console.log("Billing");
line("paying users (active/trialing sub)", s.billing.paying);
line("in 2nd month or later", s.billing.inSecondMonthOrLater);
line("subscription statuses", JSON.stringify(s.billing.statusCounts));
console.log();

console.log("Runs");
line("total runs recorded", s.runs.total);
line("  reviews", s.runs.reviews);
line("  PR summaries", s.runs.prSummaries);
line("runs in last 24h", s.runs.last24h);
line("users past their free-run allowance", s.freeTier.pastFreeRuns);
line("  of those, not subscribed", s.freeTier.exhaustedNotSubscribed);
console.log();
EOF
else
  echo "Users (adminStats:overview not deployed; listing Better Auth + connected repos)"
  echo
fi

USERS_JSON=$(npx convex data user ${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"} --component betterAuth --format json --limit 1000)
REPOS_JSON=$(npx convex data connectedRepos ${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"} --format json --limit 1000)

WINDOW_MS=$((HOURS * 3600 * 1000))
REVIEWS_SQL="SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.repo_full_name, t.reviews DESC), '[]'::json) FROM (SELECT repo_full_name, user_id, count(*)::int AS reviews, count(*) FILTER (WHERE created_at_ms >= (extract(epoch from now()) * 1000)::bigint - ${WINDOW_MS})::int AS recent, max(created_at_ms) AS last_ms FROM code_review_history_runs GROUP BY 1, 2) t"

REVIEWS_JSON='[]'
if REVIEWS_JSON=$(scripts/rds.sh "$RDS_ENV" "$REVIEWS_SQL" 2>/tmp/gx-status-rds.err); then
  :
else
  echo "Repos — could not read RDS ($RDS_ENV):"
  echo "  $(tr '\n' ' ' < /tmp/gx-status-rds.err | cut -c1-400)"
  echo
  REVIEWS_JSON='[]'
fi

# psql -At still may wrap; take the last non-empty line
REVIEWS_JSON=$(printf '%s\n' "$REVIEWS_JSON" | awk 'NF {line=$0} END {print line}')
[[ -n "$REVIEWS_JSON" ]] || REVIEWS_JSON='[]'

node - <<'EOF' "$USERS_JSON" "$REPOS_JSON" "$REVIEWS_JSON" "$HOURS"
const users = JSON.parse(process.argv[2]);
const connected = JSON.parse(process.argv[3]);
const reviews = JSON.parse(process.argv[4]);
const hours = process.argv[5];

const byId = new Map();
for (const u of users) {
  byId.set(u._id, u);
}
const label = (userId) => {
  const u = byId.get(userId);
  if (!u) return userId;
  const name = u.name || u.username || u.displayUsername || userId;
  return u.email ? `${name} <${u.email}>` : name;
};

const repos = new Map();
const ensure = (fullName) => {
  if (!repos.has(fullName)) {
    repos.set(fullName, { connected: [], reviewers: [], reviews: 0, recent: 0, lastMs: 0 });
  }
  return repos.get(fullName);
};

for (const r of connected) {
  const row = ensure(r.fullName);
  row.connected.push(r.userId);
}
for (const r of reviews) {
  const row = ensure(r.repo_full_name);
  row.reviewers.push(r);
  row.reviews += r.reviews;
  row.recent += r.recent;
  if (r.last_ms > row.lastMs) row.lastMs = r.last_ms;
}

const names = [...repos.keys()].sort((a, b) => {
  const da = repos.get(a), db = repos.get(b);
  return db.reviews - da.reviews || a.localeCompare(b);
});

console.log(`Repos (reviews last ${hours}h vs all-time; connected users)`);
if (names.length === 0) {
  console.log("  none");
} else {
  for (const fullName of names) {
    const row = repos.get(fullName);
    const connectedUsers = [...new Set(row.connected)].map(label);
    const reviewerUsers = row.reviewers
      .sort((a, b) => b.reviews - a.reviews)
      .map((r) => `${label(r.user_id)} (${r.recent}/${r.reviews})`);
    console.log(`  ${fullName}`);
    console.log(`    ${"reviews (window / all)".padEnd(36)} ${row.recent} / ${row.reviews}`);
    console.log(`    ${"connected users".padEnd(36)} ${connectedUsers.join(", ") || "—"}`);
    console.log(`    ${"reviewed by".padEnd(36)} ${reviewerUsers.join(", ") || "—"}`);
  }
}
console.log();
EOF

ecs_errors() {
  local env="$1"
  local group="/ecs/gx-server-$env"
  local start=$(( ( $(date +%s) - HOURS * 3600 ) * 1000 ))

  echo
  echo "ECS errors — $group (last ${HOURS}h)"

  local messages
  if ! messages=$(aws logs filter-log-events \
      --region "$REGION" \
      --log-group-name "$group" \
      --start-time "$start" \
      --filter-pattern '?error ?Error ?ERROR' \
      --query 'events[].message' \
      --output json 2>&1); then
    echo "  could not read logs: $messages"
    return
  fi

  node - <<'EOF' "$messages"
const events = JSON.parse(process.argv[2]);
if (events.length === 0) {
  console.log("  none");
} else {
  console.log(`  ${events.length} matching log line(s); last 20:`);
  for (const m of events.slice(-20)) {
    console.log(`  | ${m.trimEnd().slice(0, 400)}`);
  }
}
EOF
}

ecs_errors production
$INCLUDE_STAGING && ecs_errors staging

echo
echo "Done."
