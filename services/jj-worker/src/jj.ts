import { spawn } from "node:child_process";

export class JjCommandError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "JjCommandError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

const MUTATING_JJ_COMMANDS = new Set([
  "edit",
  "new",
  "split",
  "rebase",
  "squash",
  "describe",
  "restore",
  "bookmark",
  "abandon",
]);

/** jj treats remote bookmark commits as immutable by default; worker must rewrite stacks. */
export async function runJjMutate(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  if (args.length > 0 && MUTATING_JJ_COMMANDS.has(args[0]!)) {
    return runJj(cwd, [...args, "--ignore-immutable"]);
  }
  return runJj(cwd, args);
}

export async function ensureWorkerRepositoryConfig(cwd: string): Promise<void> {
  await runJj(cwd, [
    "config",
    "set",
    "--repo",
    'revset-aliases."immutable_heads()"',
    "none()",
  ]);
}

export async function runJj(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("jj", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new JjCommandError(
          `jj ${args.join(" ")} failed (${code ?? "unknown"}): ${stderr.trim() || stdout.trim()}`,
          code,
          stderr,
        ),
      );
    });
  });
}

export async function diffRevisionGit(
  cwd: string,
  revision: string,
): Promise<string> {
  const { stdout } = await runJj(cwd, ["diff", "-r", revision, "--git"]);
  return stdout;
}

export async function resolveChangeRevision(
  cwd: string,
  branchName: string,
  changeId: string,
  commitIdHint?: string | null,
): Promise<string> {
  const hint = commitIdHint?.trim();
  if (hint) {
    try {
      const { stdout } = await runJj(cwd, [
        "log",
        "-r",
        hint,
        "-n",
        "1",
        "--no-graph",
        "-T",
        "commit_id",
      ]);
      const resolved = stdout.trim();
      if (resolved) return resolved;
    } catch {
      // Fall through to revset resolution.
    }
  }

  try {
    const { stdout } = await runJj(cwd, [
      "log",
      "-r",
      `change_id(${changeId}) & ${branchName}..`,
      "-n",
      "1",
      "--no-graph",
      "-T",
      "commit_id",
    ]);
    const onStack = stdout.trim();
    if (onStack) return onStack;
  } catch {
    // Fall through.
  }

  const { stdout } = await runJj(cwd, [
    "log",
    "-r",
    `${changeId}/0`,
    "-n",
    "1",
    "--no-graph",
    "-T",
    "commit_id",
  ]);
  const latest = stdout.trim();
  if (!latest) {
    throw new Error(
      `Could not resolve change ${changeId} on bookmark ${branchName}`,
    );
  }
  return latest;
}

export async function resolveBookmarkHead(
  cwd: string,
  bookmarkName: string,
): Promise<string> {
  const { stdout } = await runJj(cwd, [
    "log",
    "-r",
    bookmarkName,
    "-n",
    "1",
    "--no-graph",
    "-T",
    "commit_id",
  ]);
  const commitId = stdout.trim().split(/\s+/)[0];
  if (!commitId) {
    throw new Error(`Could not resolve head commit for bookmark ${bookmarkName}`);
  }
  return commitId;
}
