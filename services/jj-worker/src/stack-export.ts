import type { ExportedPushBundle, ExportedStackPayload } from "./stack-types";
import { runJj, diffRevisionGit } from "./jj";

const JJ_STACK_LINE_TEMPLATE =
  'change_id ++ "|" ++ commit_id ++ "|" ++ description.first_line() ++ "|" ++ parents.map(|c| c.change_id()).join(",") ++ "\\n"';

type JjLogRow = {
  changeId: string;
  commitId: string;
  description: string;
  parentChangeId: string | null;
};

function quoteJjRev(name: string): string {
  if (/[\s"()&|]/.test(name)) {
    return `"${name.replace(/"/g, '\\"')}"`;
  }
  return name;
}

/** Match gx CLI: stack slice from trunk to bookmark, not full repo history. */
function jjStackRevset(bookmarkName: string): string {
  const base = "mutable() & ~empty() & ~hidden() & ancestors(@)";
  const trimmed = bookmarkName.trim();
  if (!trimmed) return base;
  return `${base} & ~ancestors(${quoteJjRev(trimmed)})`;
}

async function listStackChanges(
  cwd: string,
  branchName: string,
): Promise<JjLogRow[]> {
  const { stdout } = await runJj(cwd, [
    "log",
    "-r",
    jjStackRevset(branchName),
    "--reversed",
    "--no-graph",
    "-T",
    JJ_STACK_LINE_TEMPLATE,
  ]);

  const rows: JjLogRow[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|");
    if (parts.length < 3) continue;
    const changeId = parts[0]?.trim();
    const commitId = parts[1]?.trim();
    const description = parts[2]?.trim() ?? "";
    if (!changeId || !commitId) continue;
    const parentRaw = parts[3]?.trim();
    rows.push({
      changeId,
      commitId,
      description,
      parentChangeId: parentRaw ? parentRaw.split(",")[0]?.trim() || null : null,
    });
  }
  return rows;
}

async function patchForChange(cwd: string, changeId: string): Promise<string> {
  return diffRevisionGit(cwd, changeId);
}

async function filesForChange(cwd: string, changeId: string): Promise<string[]> {
  const { stdout } = await runJj(cwd, [
    "diff",
    "-r",
    changeId,
    "--name-only",
  ]);
  return stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

function mergeStackMetadata(
  previousStack: ExportedStackPayload[] | undefined,
  exported: ExportedStackPayload[],
): ExportedStackPayload[] {
  const previousByJjId = new Map<string, ExportedStackPayload>();
  for (const entry of previousStack ?? []) {
    previousByJjId.set(entry.change.jj_change_id, entry);
  }

  return exported.map((entry, index) => {
    const previous = previousByJjId.get(entry.change.jj_change_id);
    return {
      ...entry,
      branch_name: previous?.branch_name ?? entry.branch_name,
      base_branch_name: previous?.base_branch_name ?? entry.base_branch_name,
      github_pull_request_url:
        previous?.github_pull_request_url ?? entry.github_pull_request_url,
      change: {
        ...entry.change,
        id: previous?.change.id ?? index + 1,
        parent_change_id: previous?.change.parent_change_id,
        status: previous?.change.status ?? entry.change.status,
      },
    };
  });
}

export async function exportStackFromWorkspace(
  cwd: string,
  branchName: string,
  previousPayload: ExportedPushBundle,
  headCommitId: string,
): Promise<{ payload: ExportedPushBundle; newJjChangeId: string | null }> {
  const rows = await listStackChanges(cwd, branchName);
  const stack: ExportedStackPayload[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const previousEntry = previousPayload.stack?.find(
      (item) => item.change.jj_change_id === row.changeId,
    );
    const patch = await patchForChange(cwd, row.changeId);
    const files =
      (await filesForChange(cwd, row.changeId)) ||
      previousEntry?.change.files ||
      [];

    stack.push({
      change: {
        id: previousEntry?.change.id ?? index + 1,
        jj_change_id: row.changeId,
        current_commit_id: row.commitId,
        description:
          row.description || previousEntry?.change.description || "Split change",
        parent_change_id:
          previousEntry?.change.parent_change_id ?? row.parentChangeId ?? undefined,
        status: previousEntry?.change.status ?? "published",
        files,
      },
      branch_name: previousEntry?.branch_name ?? branchName,
      base_branch_name:
        previousEntry?.base_branch_name ??
        (typeof previousPayload.repo.default_branch === "string"
          ? previousPayload.repo.default_branch
          : "main"),
      patch,
      github_pull_request_url: previousEntry?.github_pull_request_url,
    });
  }

  const mergedStack = mergeStackMetadata(previousPayload.stack, stack);
  const previousIds = new Set(
    (previousPayload.stack ?? []).map((item) => item.change.jj_change_id),
  );
  const newJjChangeId =
    mergedStack.find((item) => !previousIds.has(item.change.jj_change_id))?.change
      .jj_change_id ?? null;

  const payload: ExportedPushBundle = {
    ...previousPayload,
    created_at: Date.now(),
    push: {
      ...previousPayload.push,
      head_commit_id: headCommitId,
      branch_name: branchName,
    },
    stack: mergedStack,
    change: mergedStack[mergedStack.length - 1]?.change,
  };

  return { payload, newJjChangeId };
}
