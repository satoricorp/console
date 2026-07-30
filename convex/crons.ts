import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// OSS "watch" rail poll. Dormant until the watchlist has enabled rows AND the
// server has TX_WATCH_ENABLED=1 — an empty list or a disabled server route makes
// each tick a cheap no-op. Interval is deliberately gentle to stay well within
// GitHub's rate limits and to avoid looking like aggressive automation.
crons.interval(
  "oss-watch-poll",
  { minutes: 3 },
  internal.watchlistActions.runWatchTick,
  {},
);

export default crons;
