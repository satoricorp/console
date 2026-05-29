import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyUnifiedPatch } from "./workspace";
import { JjCommandError, diffRevisionGit, resolveChangeRevision, runJjMutate } from "./jj";
import type { JjOp, SplitToChangeOp } from "./types";
import { buildRemainingDiff, buildSelectedDiff } from "./patch-split";
import { dedupeSplitPaths, writeGxSplitSpecFile } from "./split-spec";

function quoteRev(rev: string): string {
  return rev;
}

async function editChange(
  cwd: string,
  branchName: string,
  changeId: string,
  commitIdHint?: string,
): Promise<string> {
  const revision = await resolveChangeRevision(
    cwd,
    branchName,
    changeId,
    commitIdHint,
  );
  await runJjMutate(cwd, ["edit", revision]);
  return revision;
}

async function applySplitToChange(
  cwd: string,
  branchName: string,
  op: SplitToChangeOp,
): Promise<string | null> {
  await editChange(
    cwd,
    branchName,
    op.sourceChangeId,
    op.sourceCommitId,
  );

  const { filePaths, lineRanges } = dedupeSplitPaths(
    op.filePaths ?? [],
    op.lineRanges ?? [],
  );

  if (filePaths.length === 0 && lineRanges.length === 0) {
    throw new Error("split_to_change requires filePaths or lineRanges");
  }

  if (lineRanges.length > 0 && filePaths.length === 0) {
    const currentDiff = await diffRevisionGit(cwd, "@");
    const selectedDiff = buildSelectedDiff(currentDiff, lineRanges);
    if (!selectedDiff.trim()) {
      throw new Error("No diff hunks matched the selected line ranges");
    }
    const remainingDiff = buildRemainingDiff(currentDiff, lineRanges);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gx-split-"));
    const selectedPatchPath = path.join(tempDir, "selected.patch");
    const remainingPatchPath = path.join(tempDir, "remaining.patch");
    await writeFile(selectedPatchPath, selectedDiff, "utf8");
    await writeFile(remainingPatchPath, remainingDiff, "utf8");

    // Empty change based on source's parent, then apply selected hunks via git.
    await runJjMutate(cwd, ["new", "@-", "-m", op.description]);
    await applyUnifiedPatch(cwd, selectedPatchPath);
    const { stdout: newChangeIdOut } = await runJjMutate(cwd, [
      "log",
      "-r",
      "@",
      "-n",
      "1",
      "-T",
      "change_id",
    ]);
    const newChangeId = newChangeIdOut.trim();

    await editChange(
      cwd,
      branchName,
      op.sourceChangeId,
      op.sourceCommitId,
    );
    await runJjMutate(cwd, ["restore", "--from", "@-", "."]);
    if (remainingDiff.trim()) {
      await applyUnifiedPatch(cwd, remainingPatchPath);
    }

    await writeGxSplitSpecFile(cwd, {
      version: 1,
      description: op.description,
      entries: lineRanges.map((range) => ({
        path: range.filePath,
        side: range.side,
        start_line: range.startLine,
        end_line: range.endLine,
      })),
    });

    return newChangeId || null;
  }

  const args = ["split", "-m", op.description];
  if (filePaths.length > 0) {
    args.push("--", ...filePaths);
  }
  await runJjMutate(cwd, args);

  if (lineRanges.length > 0) {
    await writeGxSplitSpecFile(cwd, {
      version: 1,
      description: op.description,
      entries: lineRanges.map((range) => ({
        path: range.filePath,
        side: range.side,
        start_line: range.startLine,
        end_line: range.endLine,
      })),
    });
  }

  const { stdout } = await runJjMutate(cwd, [
    "log",
    "-r",
    "@-",
    "-n",
    "1",
    "-T",
    "change_id",
  ]);
  return stdout.trim() || null;
}

export async function applyOps(
  cwd: string,
  branchName: string,
  ops: JjOp[],
): Promise<string | null> {
  let newChangeId: string | null = null;

  for (const op of ops) {
    switch (op.type) {
      case "describe": {
        await runJjMutate(cwd, [
          "describe",
          "-r",
          quoteRev(op.changeId),
          "-m",
          op.description,
        ]);
        break;
      }
      case "amend": {
        const args = ["describe", "-r", quoteRev(op.changeId)];
        if (op.description) {
          args.push("-m", op.description);
        }
        await runJjMutate(cwd, args);
        break;
      }
      case "relocate_change": {
        await runJjMutate(cwd, [
          "rebase",
          "-s",
          quoteRev(op.changeId),
          "-d",
          quoteRev(op.parentChangeId),
        ]);
        break;
      }
      case "squash": {
        await runJjMutate(cwd, [
          "squash",
          "--from",
          quoteRev(op.sourceChangeId),
          "--into",
          quoteRev(op.targetChangeId),
        ]);
        break;
      }
      case "rebase": {
        const sources = op.changeIds.map((id) => quoteRev(id)).join("|");
        await runJjMutate(cwd, [
          "rebase",
          "-s",
          sources,
          "-d",
          quoteRev(op.ontoChangeId),
        ]);
        break;
      }
      case "restack": {
        if (op.changeIds && op.changeIds.length > 0) {
          const sources = op.changeIds.map((id) => quoteRev(id)).join("|");
          await runJjMutate(cwd, ["rebase", "-s", sources, "-b", branchName]);
        } else {
          await runJjMutate(cwd, ["rebase", "-b", branchName]);
        }
        break;
      }
      case "split_to_change": {
        newChangeId = await applySplitToChange(cwd, branchName, op);
        break;
      }
      default: {
        const exhaustive: never = op;
        throw new Error(`Unsupported jj op: ${(exhaustive as JjOp).type}`);
      }
    }
  }

  return newChangeId;
}

export function formatJjError(error: unknown): string {
  if (error instanceof JjCommandError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown jj error";
}
