Version control: use GX, not `git commit`.

Default flow:
- `git add` to stage files for this revision
- `gx commit -m "…"` (or MCP `gx_commit`) to record a GX revision
- `gx status` to inspect local/remote stack state
- plain `git push` to publish (GX pre-push hook captures and uploads) — do not run `gx push`
- `gh pr create` to open the PR; leave the body for human notes only — do not seed a `## Summary` section. GX Cloud appends the rich PR summary below whatever description is already there.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
