Version control: plain Git. gx's surface here is **review**, not committing.

Default flow:
- `git add` to stage
- `git commit -m "…"` — plain Git. Capture is hook-driven: the `prepare-commit-msg` hook stamps
  the trailer and `pre-push` matches sessions, so a plain commit is captured. Do not use
  `gx commit`.
- `git push` to publish — the gx pre-push hook captures and uploads. Do not run `gx push` or
  `gx capture push`; the hook is the only publish path.
- `gh pr create` to open the PR; leave the body for human notes only — do not seed a `## Summary`
  section. gx Cloud appends the rich PR summary below whatever description is already there.
- `gx review` (or MCP `gx_review`) to review changes.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
