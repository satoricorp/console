/**
 * Line counts for a PR summary's Blast Radius line, computed from the patches
 * the publish bundle already carries.
 *
 * Nothing upstream reports added/removed lines. `fileStats` on a capture
 * extract is `{excludedFiles: N}` — a count of files left out of capture, with
 * no line information at all — and a gx.pr artifact carries no equivalent. The
 * only place a line count could come from was the model, which was shown a
 * patch excerpt truncated at 3000 characters per revision and asked to fill in
 * "+X/-Y lines". On satoricorp/gx#112 that produced "+95/-0" against a real
 * +137/-0: a precise-looking number with no source behind it.
 *
 * These functions count the full patch instead, before any truncation, so the
 * prompt can state the number as fact rather than invite a guess.
 */

export type FileDiffStat = {
  file: string;
  added: number;
  removed: number;
};

export type DiffStats = {
  files: number;
  added: number;
  removed: number;
  /**
   * How many revision patches the totals were summed over. A publish bundle's
   * revisions are individual commits, so with more than one the line totals are
   * commit-wise and can exceed the net PR diff (a line added in one commit and
   * rewritten in the next counts twice). The caller states this rather than
   * presenting a commit-wise sum as if it were GitHub's two-dot total.
   */
  revisions: number;
  perFile: FileDiffStat[];
};

const DIFF_GIT_RE = /^diff --git a\/(\S+) b\/(\S+)/;

/**
 * Count added and removed lines per file in one unified diff.
 *
 * Only lines inside a hunk count, and a hunk starts at an `@@` header. That
 * distinction is the whole point: a prefix test alone cannot tell the `---
 * a/file` header from a deleted line whose own content begins with `--`, and
 * skipping every line that starts with `---`/`+++` silently undercounts real
 * patches. Removing three column-0 `-- comment` lines from a SQL migration —
 * this repository has several, `014_rename_gx_prefix.sql` alone has fifteen —
 * reported +1/-0 against git's own +1/-4. The same held for added lines whose
 * content starts with `++`. Since the prompt now presents this number as
 * authoritative, a wrong one would be asserted with more confidence than the
 * guess it replaced.
 *
 * `\ No newline at end of file` is a marker rather than a change, so it is
 * skipped. Hunks before the first `diff --git` (a bare patch with no header)
 * are attributed to `fallbackFile`.
 */
export function parsePatchStats(
  patch: string,
  fallbackFile = "",
): FileDiffStat[] {
  const trimmed = patch?.trim();
  if (!trimmed) return [];

  const byFile = new Map<string, FileDiffStat>();
  const statFor = (file: string): FileDiffStat => {
    const key = file || fallbackFile;
    let stat = byFile.get(key);
    if (!stat) {
      stat = { file: key, added: 0, removed: 0 };
      byFile.set(key, stat);
    }
    return stat;
  };

  let current = "";
  let seenHeader = false;
  let inHunk = false;
  for (const line of trimmed.split("\n")) {
    // A `diff --git` can only appear at column 0 outside a hunk: every line of
    // hunk content carries a leading `+`, `-` or space.
    const match = DIFF_GIT_RE.exec(line);
    if (match) {
      current = match[2] ?? match[1] ?? "";
      seenHeader = true;
      inHunk = false;
      // Register the file even when its diff body is empty (mode change,
      // pure rename): it is still a file the PR touched.
      statFor(current);
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    // Everything between a file header and its first hunk is metadata:
    // `index`, `old mode`, `similarity`, `--- a/…`, `+++ b/…`, `Binary files`.
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      statFor(seenHeader ? current : "").added += 1;
    } else if (line.startsWith("-")) {
      statFor(seenHeader ? current : "").removed += 1;
    }
  }

  return [...byFile.values()].filter(
    (stat) => stat.file || stat.added > 0 || stat.removed > 0,
  );
}

/**
 * Total the patches of every revision in the bundle.
 *
 * Files are unioned, so the file count is exact even when several commits touch
 * the same path. Line counts are summed, which is exact for the single-commit
 * case and an upper bound otherwise — `revisions` tells the caller which.
 */
export function computeDiffStats(
  revisions: Array<{ patch?: string | null; files?: string[] }>,
): DiffStats | null {
  const perFile = new Map<string, FileDiffStat>();
  let patched = 0;

  for (const revision of revisions) {
    const patch = revision.patch ?? "";
    const stats = parsePatchStats(patch, revision.files?.[0] ?? "");
    if (patch.trim()) patched += 1;
    for (const stat of stats) {
      const existing = perFile.get(stat.file);
      if (existing) {
        existing.added += stat.added;
        existing.removed += stat.removed;
      } else {
        perFile.set(stat.file, { ...stat });
      }
    }
    // A revision can list files whose diff was not carried (binary, or a patch
    // the CLI omitted). They still count toward the file total.
    for (const file of revision.files ?? []) {
      if (file && !perFile.has(file)) {
        perFile.set(file, { file, added: 0, removed: 0 });
      }
    }
  }

  if (perFile.size === 0) return null;

  const values = [...perFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  return {
    files: values.length,
    added: values.reduce((sum, stat) => sum + stat.added, 0),
    removed: values.reduce((sum, stat) => sum + stat.removed, 0),
    revisions: patched,
    perFile: values,
  };
}

/**
 * The line the prompt states as fact. When the totals are commit-wise (more
 * than one patched revision) it says so, so the model does not present a sum
 * that may exceed the net PR diff as if it were exact.
 *
 * The OSS watch rail builds this line from GitHub's own additions/deletions
 * rather than from a parsed patch, so the wording claims only that the counts
 * cover the complete diff — which is true either way — and not how they were
 * obtained.
 */
export function formatDiffStatsFact(stats: DiffStats): string {
  const basis =
    stats.revisions > 1
      ? ` (summed over ${stats.revisions} commit patches, so the net PR diff may be smaller)`
      : "";
  return `Diff stats (authoritative — counted over the complete diff; use these exact numbers and do not derive counts from the possibly-truncated diff text below): ${stats.files} file(s), +${stats.added}/-${stats.removed} lines${basis}`;
}
