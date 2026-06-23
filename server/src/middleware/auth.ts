import { createMiddleware } from "hono/factory";
import { getSql } from "../db";
import type { AuthContext } from "../types";

export type AppEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function resolveCloudApiKey(
  token: string,
  userIdHeader: string | undefined,
  orgIdHeader: string | undefined,
): AuthContext | null {
  const expected = process.env.GX_CLOUD_API_KEY?.trim();
  const userId = userIdHeader?.trim() || "local-user";
  if (!expected || token !== expected) {
    return null;
  }
  return { orgId: orgIdHeader?.trim() || "", userId, tokenLabel: "cloud-api-key" };
}

function localDevAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.GX_CLOUD_API_KEY?.trim();
}

function resolveLocalDevAuth(
  userIdHeader: string | undefined,
  orgIdHeader: string | undefined,
): AuthContext {
  return {
    orgId: orgIdHeader?.trim() || "",
    userId: userIdHeader?.trim() || "local-user",
    tokenLabel: "local-dev",
  };
}

type GitHubUser = {
  id?: number;
  login?: string;
};

type CliSessionVerifyResponse = {
  session_id?: string;
  user_id?: string;
  github_user_id?: number;
  github_login?: string;
  machine_id?: string;
};

const githubAuthCache = new Map<string, AuthContext>();

function convexSiteURL(): string {
  return process.env.CONVEX_SITE_URL?.trim() || "";
}

function cliSessionVerifyURL(): string {
  const base = convexSiteURL();
  return base ? `${base.replace(/\/+$/, "")}/cx/auth/cli/verify` : "";
}

function looksLikeCliSessionToken(token: string): boolean {
  return token.startsWith("gxcs_");
}

async function resolveCliSessionToken(
  token: string,
  orgIdHeader: string | undefined,
): Promise<AuthContext | null> {
  if (!looksLikeCliSessionToken(token)) {
    return null;
  }

  const verifyURL = cliSessionVerifyURL();
  if (!verifyURL) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(verifyURL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "gx-cloud",
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const session = (await response.json()) as CliSessionVerifyResponse;
  if (!session.user_id) {
    return null;
  }

  return {
    orgId: orgIdHeader?.trim() || "",
    userId: session.user_id,
    tokenLabel: session.github_login ? `gx-cli:${session.github_login}` : "gx-cli",
    githubUserId: session.github_user_id,
    githubUserLogin: session.github_login,
    sessionId: session.session_id,
    machineId: session.machine_id,
  };
}

async function resolveGitHubToken(
  token: string,
  orgIdHeader: string | undefined,
): Promise<AuthContext | null> {
  const orgId = orgIdHeader?.trim() || "";
  const cached = githubAuthCache.get(`${orgId}:${token}`);
  if (cached) {
    return cached;
  }

  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "gx-cloud",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const user = (await response.json()) as GitHubUser;
  if (typeof user.id !== "number") {
    return null;
  }

  const auth = {
    orgId,
    userId: `github:${user.id}`,
    tokenLabel: user.login ? `github:${user.login}` : "github",
  };
  githubAuthCache.set(`${orgId}:${token}`, auth);
  return auth;
}

let defaultOrgIdCache: string | null = null;

async function defaultOrgId(): Promise<string> {
  if (defaultOrgIdCache) {
    return defaultOrgIdCache;
  }

  const db = getSql();
  const [existing] = await db<{ id: string }[]>`
    SELECT id FROM orgs
    WHERE installation_id IS NULL
    ORDER BY created_at_ms ASC
    LIMIT 1
  `;
  if (existing) {
    defaultOrgIdCache = existing.id;
    return existing.id;
  }

  const [created] = await db<{ id: string }[]>`
    INSERT INTO orgs (plan, created_at_ms)
    VALUES ('free', ${Date.now()})
    RETURNING id
  `;
  defaultOrgIdCache = created.id;
  return created.id;
}

async function withDefaultOrg(auth: AuthContext): Promise<AuthContext> {
  if (auth.orgId) {
    return auth;
  }
  return { ...auth, orgId: await defaultOrgId() };
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (!token && !localDevAuthEnabled()) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const auth =
    (token
      ? resolveCloudApiKey(token, c.req.header("X-User-Id"), c.req.header("X-Org-Id")) ??
        (await resolveCliSessionToken(token, c.req.header("X-Org-Id"))) ??
        (await resolveGitHubToken(token, c.req.header("X-Org-Id")))
      : null) ??
    (localDevAuthEnabled()
      ? resolveLocalDevAuth(c.req.header("X-User-Id"), c.req.header("X-Org-Id"))
      : null);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("auth", await withDefaultOrg(auth));
  await next();
});
