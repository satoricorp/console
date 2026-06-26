import { createHash } from "node:crypto";

export function githubPullFileLineUrl(
  githubPrUrl: string | null | undefined,
  file: string,
  line: number | null | undefined,
): string | null {
  const prUrl = normalizePullUrl(githubPrUrl);
  if (!prUrl || !file.trim() || typeof line !== "number" || line <= 0) {
    return null;
  }

  const diffId = createHash("sha256").update(file).digest("hex");
  return `${prUrl}/files#diff-${diffId}R${Math.floor(line)}`;
}

function normalizePullUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) return null;
  return /\/pull\/\d+(?:$|[/?#])/.test(trimmed) ? trimmed : null;
}
