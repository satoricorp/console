import { readFileSync } from "node:fs";
import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type GitHubAppInstallationGrant = {
  installationId: number;
  repoFullName: string;
};

export function verifyGitHubWebhookSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret = webhookSecret(),
): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function githubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID?.trim() && githubAppPrivateKey(),
  );
}

export function createGitHubAppJWT(nowSeconds = Math.floor(Date.now() / 1000)): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = githubAppPrivateKey();
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }

  const header = base64urlJSON({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJSON({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  });
  const input = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .end()
    .sign(privateKey, "base64url");
  return `${input}.${signature}`;
}

export async function getInstallationAccessToken(
  installationId: number,
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${createGitHubAppJWT()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gx-server",
      },
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub installation token failed (${response.status}): ${body}`,
    );
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("GitHub installation token response missing token");
  }
  return payload.token;
}

export async function findInstalledRepository(
  db: SqlExecutor,
  repoFullName: string,
): Promise<GitHubAppInstallationGrant | null> {
  const [row] = await db<
    Array<{ installation_id: string | number; full_name: string }>
  >`
    SELECT r.installation_id, r.full_name
    FROM github_app_repositories r
    JOIN github_app_installations i
      ON i.installation_id = r.installation_id
    WHERE r.full_name = ${repoFullName}
      AND r.access_state = 'installed'
      AND i.suspended_at_ms IS NULL
    LIMIT 1
  `;
  if (!row) return null;
  return {
    installationId: Number(row.installation_id),
    repoFullName: row.full_name,
  };
}

export async function getInstallationTokenForRepo(
  db: SqlExecutor,
  repoFullName: string,
): Promise<string | null> {
  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) return null;
  return getInstallationAccessToken(grant.installationId);
}

export async function resolveOrgIdForInstallation(
  db: SqlExecutor,
  installationId: number,
): Promise<string | null> {
  const [row] = await db<{ id: string }[]>`
    SELECT id FROM orgs WHERE installation_id = ${installationId}
  `;
  return row?.id ?? null;
}

function webhookSecret(): string {
  return (
    process.env.GITHUB_WEBHOOK_SECRET?.trim() ||
    process.env.GX_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function githubAppPrivateKey(): string {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (inline) {
    return inline;
  }
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    try {
      return readFileSync(keyPath, "utf8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

function base64urlJSON(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
