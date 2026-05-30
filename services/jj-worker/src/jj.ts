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
    "-T",
    "commit_id",
  ]);
  const commitId = stdout.trim();
  if (!commitId) {
    throw new Error(`Could not resolve head commit for bookmark ${bookmarkName}`);
  }
  return commitId;
}
