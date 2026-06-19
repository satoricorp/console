# GitHub PR Review Comments

## Product Goal

Start commenting on GitHub pull requests when changes are pushed, with:

- An overview of what changed
- Architecture suggestions
- Best-practice suggestions
- Overall reliability and security scores
- Additional suggestions for follow-up work

This idea is parked for later. The current preferred first version is narrower than a full GitHub-native review bot.

## Preferred V1 Direction

- Trigger reviews from `gx pr` publishes only.
- Post one sticky GitHub PR overview comment, updating the existing managed comment on each new GX publish.
- Keep scores advisory only. Do not set required checks or block merges in v1.

This uses the rich GX payload already captured during publish: changed files, patches, stack context, PR metadata, and agent session history. It avoids the extra webhook and deduplication work needed to review every ordinary GitHub push.

## Implementation Outline

Add Postgres-backed job/comment state in `server`:

- Track `bookmark_id`, `event_id`, `repo_full_name`, `github_pr_number`, `head_commit_id`, `status`, `github_comment_id`, `last_error`, and timestamps.
- Make review job creation idempotent with a unique key on `event_id`.
- Track the managed GitHub comment so repeated pushes update one comment instead of creating noise.

Extend `POST /gx/pr` ingest:

- After the existing ingest transaction succeeds, enqueue a review job only when the payload includes a GitHub PR URL.
- Do not fail `gx pr` if review generation or GitHub writeback fails.
- Persist failures for debugging and possible retry.

Add review generation:

- Use the full GX payload to extract changed files, stack patches, PR title/body where available, and session summaries.
- Reuse the existing OpenAI and Turbopuffer retrieval patterns from PR chat for repository context when indexed context exists.
- Return structured markdown sections:
  - Overview
  - Architecture suggestions
  - Best-practice suggestions
  - Reliability score
  - Security score
  - Additional suggestions

Add GitHub writeback:

- Use a GitHub App installation token when available; fall back to the existing service GitHub token only for local/dev.
- Find an existing managed comment by a hidden marker such as `<!-- gx-pr-review-comment:v1 -->`.
- Update the managed comment if found; otherwise create a new PR issue comment.
- Include commit SHA and GX event id in the comment so users know what was reviewed.

## GitHub Permissions And Interfaces

Likely GitHub App permissions:

- `pull_requests: read`
- `contents: read` if fetching GitHub diff/files later
- `issues: write` for creating and updating PR overview comments

Potential env/config:

- `GX_REVIEW_COMMENT_ENABLED=true|false`
- `GX_REVIEW_SERVICE_SECRET` shared between `server` and Convex if review generation is exposed as a service-only Convex action
- Optional `GX_REVIEW_MODEL`, defaulting to the existing review/chat model unless changed later

## Test Plan

- Unit test payload extraction for changed files, stack patches, PR number/URL, and missing-PR cases.
- Unit test sticky comment behavior:
  - Creates a comment when none exists
  - Updates the existing managed comment
  - Ignores unrelated user comments
  - Skips safely when the GitHub PR URL is absent
- Integration test `POST /gx/pr`:
  - Stores event/bookmark as it does today
  - Enqueues one review job after successful ingest
  - Does not fail ingest when enqueue, review generation, or comment posting fails
- Mock GitHub API tests for 401, 403, 404, and rate-limit responses, with persisted `last_error`.
- Typecheck `server` and Convex. Run existing app lint/build checks where practical.

## Deferred Alternatives

- GitHub-native trigger: handle `pull_request.synchronize` events so every GitHub PR push is reviewed, including non-GX pushes.
- New comment per push: keep a historical review snapshot, at the cost of comment noise.
- Inline review comments: add line-specific feedback with the Pull Request Review APIs, at the cost of more false-positive risk and API complexity.
- Blocking checks: create GitHub checks/statuses and optionally fail when reliability or security scores fall below thresholds.

## Assumptions

- V1 reviews only pushes that go through `gx pr`.
- V1 posts one PR-level overview comment, not inline review comments.
- Review generation can be eventually consistent; a short delay after `gx pr` is acceptable.
- GitHub PR overview comments should use issue comments because GitHub PRs share the issues comment API.
