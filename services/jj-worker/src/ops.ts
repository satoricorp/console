import { JjCommandError, runJj } from "./jj";
import type { JjOp } from "./types";

function quoteRev(rev: string): string {
  return rev;
}

export async function applyOps(cwd: string, branchName: string, ops: JjOp[]): Promise<void> {
  for (const op of ops) {
    switch (op.type) {
      case "describe": {
        await runJj(cwd, [
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
        await runJj(cwd, args);
        break;
      }
      case "relocate_change": {
        await runJj(cwd, [
          "rebase",
          "-s",
          quoteRev(op.changeId),
          "-d",
          quoteRev(op.parentChangeId),
        ]);
        break;
      }
      case "squash": {
        await runJj(cwd, [
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
        await runJj(cwd, [
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
          await runJj(cwd, ["rebase", "-s", sources, "-b", branchName]);
        } else {
          await runJj(cwd, ["rebase", "-b", branchName]);
        }
        break;
      }
      default: {
        const exhaustive: never = op;
        throw new Error(`Unsupported jj op: ${(exhaustive as JjOp).type}`);
      }
    }
  }
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
