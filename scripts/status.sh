#!/usr/bin/env bash
#
# Operator status report: user/billing/run counts from prod Convex, plus
# errors from the ECS server logs.
#
# Usage:
#   scripts/status.sh              # prod Convex + production ECS logs
#   scripts/status.sh --staging    # also show staging ECS logs
#   scripts/status.sh --dev        # read the dev Convex deployment instead
#   HOURS=48 scripts/status.sh     # widen the ECS error window (default 24)
#
# Needs: npx (Convex CLI auth for the prod deployment), aws CLI credentials.
# The Convex side calls adminStats:overview, which must be deployed to prod
# (a push to main deploys it).

set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east-1
HOURS="${HOURS:-24}"
INCLUDE_STAGING=false
CONVEX_FLAGS=(--prod)
for arg in "$@"; do
  case "$arg" in
    --staging) INCLUDE_STAGING=true ;;
    --dev) CONVEX_FLAGS=() ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

echo "== gx status — $(date) =="
echo

STATS=$(npx convex run adminStats:overview ${CONVEX_FLAGS[@]+"${CONVEX_FLAGS[@]}"})

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
