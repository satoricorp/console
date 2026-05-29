import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeGitRemoteUrl } from "./github";
import { resolveBookmarkHead, runJj, runJjMutate, ensureWorkerRepositoryConfig } from "./jj";

const workspaceLocks = new Map<string, Promise<void>>();

function repoSlug(repoFullName: string): string {
  return repoFullName.replace(/\//g, "__");
}

export function workspacePath(
  workspaceRoot: string,
  userId: string,
  repoFullName: string,
): string {
  return path.join(workspaceRoot, userId, repoSlug(repoFullName));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
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

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `git ${args.join(" ")} failed (${code ?? "unknown"}): ${stderr.trim() || stdout.trim()}`,
        ),
      );
    });
  });
}

/** jj 0.40 has no `jj apply`; colocated repos use git apply for unified patches. */
export async function applyUnifiedPatch(
  cwd: string,
  patchPath: string,
): Promise<void> {
  try {
    await runGit(cwd, ["apply", patchPath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git apply ${patchPath} failed: ${message}`);
  }
}

async function ensureWorkspace(
  workspaceRoot: string,
  userId: string,
  repoFullName: string,
  remoteUrl: string,
  githubToken: string,
): Promise<string> {
  const root = workspacePath(workspaceRoot, userId, repoFullName);
  await mkdir(path.dirname(root), { recursive: true });

  const jjDir = path.join(root, ".jj");
  if (!(await pathExists(jjDir))) {
    const authRemote = normalizeGitRemoteUrl(remoteUrl, githubToken);
    await runGit(path.dirname(root), [
      "clone",
      authRemote,
      path.basename(root),
    ]);
    await runJj(root, ["git", "init", "--colocate"]);
    await ensureWorkerRepositoryConfig(root);
  } else {
    await ensureWorkerRepositoryConfig(root);
  }

  await runJj(root, ["git", "fetch"]);
  return root;
}

async function ensureRemoteBookmarkTracked(
  cwd: string,
  branchName: string,
): Promise<void> {
  try {
    await runJj(cwd, ["bookmark", "track", branchName, "--remote=origin"]);
  } catch {
    // Already tracked or no matching remote bookmark yet.
  }
}

function activeBookmarkMarkerPath(cwd: string): string {
  return path.join(cwd, ".gx-worker-active-bookmark");
}

async function readActiveBookmark(cwd: string): Promise<string | null> {
  try {
    const value = await readFile(activeBookmarkMarkerPath(cwd), "utf8");
    const trimmed = value.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

async function writeActiveBookmark(cwd: string, branchName: string): Promise<void> {
  await writeFile(activeBookmarkMarkerPath(cwd), `${branchName}\n`, "utf8");
}

async function syncBookmarkFromOrigin(
  cwd: string,
  branchName: string,
): Promise<void> {
  const remoteRef = `${branchName}@origin`;
  try {
    await runJjMutate(cwd, ["edit", remoteRef]);
    await runJjMutate(cwd, [
      "bookmark",
      "set",
      branchName,
      "-r",
      "@",
      "--allow-backwards",
    ]);
    await runJjMutate(cwd, ["edit", branchName]);
  } catch {
    await runJjMutate(cwd, [
      "bookmark",
      "set",
      branchName,
      "-r",
      remoteRef,
      "--allow-backwards",
    ]);
    await runJjMutate(cwd, ["edit", branchName]);
  }
}

async function syncBookmark(
  cwd: string,
  branchName: string,
): Promise<void> {
  await ensureRemoteBookmarkTracked(cwd, branchName);

  const previousBookmark = await readActiveBookmark(cwd);
  const switchedBookmark =
    previousBookmark != null && previousBookmark !== branchName;

  if (switchedBookmark) {
    await syncBookmarkFromOrigin(cwd, branchName);
    await writeActiveBookmark(cwd, branchName);
    return;
  }

  // Same bookmark: worker stack may be ahead of origin after server-side splits.
  try {
    await runJjMutate(cwd, ["edit", branchName]);
    await writeActiveBookmark(cwd, branchName);
    return;
  } catch {
    // Local bookmark missing; bootstrap from the remote tracking bookmark.
  }

  await syncBookmarkFromOrigin(cwd, branchName);
  await writeActiveBookmark(cwd, branchName);
}

export async function withWorkspace<T>(
  workspaceRoot: string,
  userId: string,
  repoFullName: string,
  remoteUrl: string,
  githubToken: string,
  branchName: string,
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const lockKey = `${userId}:${repoFullName}`;
  const previous = workspaceLocks.get(lockKey) ?? Promise.resolve();
  let releaseLock!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  workspaceLocks.set(
    lockKey,
    previous.then(() => gate),
  );

  await previous;

  try {
    const cwd = await ensureWorkspace(
      workspaceRoot,
      userId,
      repoFullName,
      remoteUrl,
      githubToken,
    );
    await syncBookmark(cwd, branchName);
    const result = await fn(cwd);
    return result;
  } finally {
    releaseLock();
    if (workspaceLocks.get(lockKey) === gate) {
      workspaceLocks.delete(lockKey);
    }
  }
}

export async function pushBookmark(
  cwd: string,
  branchName: string,
): Promise<string> {
  await ensureRemoteBookmarkTracked(cwd, branchName);
  await runJj(cwd, ["git", "push", "--bookmark", branchName]);
  return resolveBookmarkHead(cwd, branchName);
}
