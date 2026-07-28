import { describe, expect, test } from "bun:test";
import {
  computeDiffStats,
  formatDiffStatsFact,
  parsePatchStats,
} from "../src/summary/diff-stats";

/**
 * The real satoricorp/gx#112 diff, trimmed to its structure but with the exact
 * line counts GitHub reports: doctor.go +92, doctor_code_index_test.go +45,
 * total +137/-0 across 2 files. The posted summary claimed "+95/-0".
 */
function pr112Patch(): string {
  const lines: string[] = [
    "diff --git a/internal/cli/doctor.go b/internal/cli/doctor.go",
    "index 1111111..2222222 100644",
    "--- a/internal/cli/doctor.go",
    "+++ b/internal/cli/doctor.go",
    "@@ -120,6 +120,98 @@ func runDoctor() error {",
  ];
  // Realistic Go line widths, so the whole patch lands near the real one's
  // 6163 characters and the 3000-char excerpt genuinely cuts it in half.
  for (let i = 0; i < 92; i += 1) {
    lines.push(`+\tif err := reportCodeIndexFreshness(ctx, out, ${i}); err != nil {`);
  }
  lines.push(" \treturn nil");
  lines.push(
    "diff --git a/internal/cli/doctor_code_index_test.go b/internal/cli/doctor_code_index_test.go",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/internal/cli/doctor_code_index_test.go",
    "@@ -0,0 +1,45 @@",
  );
  for (let i = 0; i < 45; i += 1) {
    lines.push(`+\twant := codeIndexStatus{Namespace: "ns", Drifted: ${i}}`);
  }
  return lines.join("\n");
}

describe("parsePatchStats", () => {
  test("counts satoricorp/gx#112 as +137/-0 across 2 files", () => {
    const stats = parsePatchStats(pr112Patch());
    expect(stats).toHaveLength(2);
    const doctor = stats.find((s) => s.file === "internal/cli/doctor.go")!;
    const test = stats.find(
      (s) => s.file === "internal/cli/doctor_code_index_test.go",
    )!;
    expect(doctor.added).toBe(92);
    expect(doctor.removed).toBe(0);
    expect(test.added).toBe(45);
    expect(test.removed).toBe(0);
  });

  test("does not count +++/--- file headers as changed lines", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2;",
    ].join("\n");
    const [stat] = parsePatchStats(patch);
    expect(stat).toEqual({ file: "a.ts", added: 1, removed: 1 });
  });

  test("ignores the no-newline marker", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");
    const [stat] = parsePatchStats(patch);
    expect(stat).toEqual({ file: "a.txt", added: 1, removed: 1 });
  });

  test("counts a delete-only patch", () => {
    const patch = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
      "-b",
      "-c",
    ].join("\n");
    expect(parsePatchStats(patch)).toEqual([
      { file: "gone.ts", added: 0, removed: 3 },
    ]);
  });

  test("returns nothing for an empty patch", () => {
    expect(parsePatchStats("")).toEqual([]);
    expect(parsePatchStats("   \n  ")).toEqual([]);
  });

  test("counts deleted SQL comments, which render as ---", () => {
    // Verified against `git diff --numstat` on a real edit to
    // server/migrations/014_rename_gx_prefix.sql: 1 added, 4 removed. A parser
    // that skips every line starting with `---` reported +1/-0. This repo's
    // migrations carry dozens of column-0 `--` comments.
    const patch = [
      "diff --git a/m.sql b/m.sql",
      "index c968f47..6573954 100644",
      "--- a/m.sql",
      "+++ b/m.sql",
      "@@ -1,6 +1,4 @@",
      "--- WP-4: drop gx_ prefix on legacy tables, add org_id, backfill orgs.",
      " ",
      "--- Backfill orgs from GitHub App installations (one org per installation)",
      " INSERT INTO orgs (installation_id, created_at_ms)",
      "@@ -8,13 +6,12 @@ SELECT",
      "--- Bootstrap org for single-player rows without installation mapping",
      "--- Rename legacy tables (FKs from 013 follow automatically)",
      " ALTER TABLE gx_pr_events RENAME TO pr_events;",
      "+-- added note",
    ].join("\n");
    expect(parsePatchStats(patch)).toEqual([
      { file: "m.sql", added: 1, removed: 4 },
    ]);
  });

  test("counts added lines whose content starts with ++", () => {
    const patch = [
      "diff --git a/notes.md b/notes.md",
      "index 1111111..2222222 100644",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -0,0 +1,3 @@",
      "++ bullet one",
      "+++ bullet two",
      "+plain",
    ].join("\n");
    expect(parsePatchStats(patch)).toEqual([
      { file: "notes.md", added: 3, removed: 0 },
    ]);
  });

  test("ignores metadata between a file header and its first hunk", () => {
    const patch = [
      "diff --git a/renamed.ts b/moved.ts",
      "similarity index 92%",
      "rename from renamed.ts",
      "rename to moved.ts",
      "index 1111111..2222222 100644",
      "--- a/renamed.ts",
      "+++ b/moved.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(parsePatchStats(patch)).toEqual([
      { file: "moved.ts", added: 1, removed: 1 },
    ]);
  });

  test("counts nothing for a binary file but still registers it", () => {
    const patch = [
      "diff --git a/logo.png b/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/logo.png and b/logo.png differ",
    ].join("\n");
    expect(parsePatchStats(patch)).toEqual([
      { file: "logo.png", added: 0, removed: 0 },
    ]);
  });
});

describe("computeDiffStats", () => {
  test("reports the true +137/-0 for the #112 bundle", () => {
    const stats = computeDiffStats([
      {
        patch: pr112Patch(),
        files: [
          "internal/cli/doctor.go",
          "internal/cli/doctor_code_index_test.go",
        ],
      },
    ])!;
    expect(stats.files).toBe(2);
    expect(stats.added).toBe(137);
    expect(stats.removed).toBe(0);
    expect(stats.revisions).toBe(1);
  });

  test("does not depend on the 3000-char prompt excerpt", () => {
    // The model was shown revision.patch.slice(0, 3000). Counting that excerpt
    // yields a wrong, precise-looking number; counting the full patch does not.
    const patch = pr112Patch();
    const excerptAdds = patch
      .slice(0, 3000)
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    expect(excerptAdds).toBeLessThan(137);
    expect(computeDiffStats([{ patch }])!.added).toBe(137);
  });

  test("unions files and flags commit-wise totals across revisions", () => {
    const stats = computeDiffStats([
      {
        patch: [
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1 +1,2 @@",
          "+one",
        ].join("\n"),
        files: ["a.ts"],
      },
      {
        patch: [
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1 +1,2 @@",
          "+two",
          "-one",
        ].join("\n"),
        files: ["a.ts"],
      },
    ])!;
    expect(stats.files).toBe(1);
    expect(stats.added).toBe(2);
    expect(stats.removed).toBe(1);
    expect(stats.revisions).toBe(2);
    expect(formatDiffStatsFact(stats)).toContain("summed over 2 commit patches");
  });

  test("counts a file the bundle listed but carried no patch for", () => {
    const stats = computeDiffStats([
      { patch: "", files: ["binary.png", "b.ts"] },
    ])!;
    expect(stats.files).toBe(2);
    expect(stats.added).toBe(0);
    expect(stats.revisions).toBe(0);
  });

  test("returns null when there is nothing to count", () => {
    expect(computeDiffStats([])).toBeNull();
    expect(computeDiffStats([{ patch: "", files: [] }])).toBeNull();
  });
});

describe("formatDiffStatsFact", () => {
  test("states the exact numbers for a single-revision PR", () => {
    const stats = computeDiffStats([
      {
        patch: pr112Patch(),
        files: [
          "internal/cli/doctor.go",
          "internal/cli/doctor_code_index_test.go",
        ],
      },
    ])!;
    const fact = formatDiffStatsFact(stats);
    expect(fact).toContain("2 file(s), +137/-0 lines");
    expect(fact).not.toContain("summed over");
  });
});

describe("formatDiffStatsFact: what was not counted", () => {
  // The CLI blanks any single commit patch over 512 KB while keeping its file
  // list, so a push can arrive with files and no diff. computeDiffStats seeds
  // its map from revision.files, so the empty-map guard never fires and the
  // line was emitted as "+0/-0 lines", labelled authoritative, with the prompt
  // ordering the model to reproduce it verbatim.
  test("withholds line counts when no patch was carried", () => {
    const stats = computeDiffStats([
      { patch: null, files: ["a.ts", "b.ts", "c.ts"] },
    ] as never);
    expect(stats).not.toBeNull();
    expect(stats!.revisions).toBe(0);
    expect(stats!.revisionsSeen).toBe(1);

    const fact = formatDiffStatsFact(stats!);
    expect(fact).not.toContain("authoritative");
    expect(fact).not.toContain("+0/-0");
    expect(fact).toContain("3 file(s)");
    expect(fact).toContain("line counts are unknown");
  });

  // A mixed bundle: the commit-wise caveat only fires above one patched
  // revision, so an undercount from a dropped patch was presented as exact.
  test("marks a partly counted bundle as a lower bound", () => {
    const stats = computeDiffStats([
      {
        patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+one\n",
        files: ["a.ts"],
      },
      { patch: null, files: ["big.ts"] },
    ] as never);
    expect(stats!.revisions).toBe(1);
    expect(stats!.revisionsSeen).toBe(2);

    const fact = formatDiffStatsFact(stats!);
    expect(fact).not.toContain("authoritative");
    expect(fact).toContain("lower bound");
    expect(fact).toContain("1 of 2");
  });

  // A fully counted bundle keeps the exact wording: the gate must not become
  // uselessly hedged.
  test("keeps the authoritative wording when everything was counted", () => {
    const stats = computeDiffStats([
      {
        patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+one\n",
        files: ["a.ts"],
      },
    ] as never);
    const fact = formatDiffStatsFact(stats!);
    expect(fact).toContain("authoritative");
    expect(fact).toContain("+1/-0 lines");
  });
});
