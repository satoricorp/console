import { createMiddleware } from "hono/factory";
import { getSql } from "../db";
import {
  healPersonalInstallMembership,
  parseGithubUserIdFromAuth,
  requireOrgMembership,
  resolveOrgIdForGithubUser,
} from "../orgs/members";
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

export function localDevAuthEnabled(): boolean {
  const enabled =
    process.env.NODE_ENV !== "production" && !process.env.GX_CLOUD_API_KEY?.trim();
  if (process.env.NODE_ENV === "production" && !process.env.GX_CLOUD_API_KEY?.trim()) {
    console.error("local-dev auth path asserted inactive in production (no GX_CLOUD_API_KEY)");
  }
  return enabled;
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

  const auth: AuthContext = {
    orgId,
    userId: `github:${user.id}`,
    tokenLabel: user.login ? `github:${user.login}` : "github",
    githubUserId: user.id,
    githubUserLogin: user.login,
  };
  githubAuthCache.set(`${orgId}:${token}`, auth);
  return auth;
}

let defaultOrgIdCache: string | null = null;

/** Org placeholder for Console BFF cloud-api-key calls that omit X-Org-Id.
 * Access checks still authorize via bookmark.user_id = X-User-Id. */
const CLOUD_API_KEY_DEFAULT_ORG_ID = "00000000-0000-4000-8000-000000000001";

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

function isTrustedInfraAuth(auth: AuthContext): boolean {
  return auth.tokenLabel === "cloud-api-key" || auth.tokenLabel === "local-dev";
}

async function enforceOrgMembership(
  auth: AuthContext,
): Promise<{ auth: AuthContext } | { status: 401 | 403; error: string }> {
  if (isTrustedInfraAuth(auth)) {
    if (auth.tokenLabel === "cloud-api-key") {
      // Console BFF sends GX_CLOUD_API_KEY + X-User-Id without X-Org-Id.
      // Use a stable placeholder so auth does not require a DB round-trip;
      // review/bookmark routes still match on bookmark.user_id = auth.userId.
      const withOrg = auth.orgId
        ? auth
        : { ...auth, orgId: CLOUD_API_KEY_DEFAULT_ORG_ID };
      console.info("cloud-api-key org access", {
        orgId: withOrg.orgId,
        userId: withOrg.userId,
        tokenLabel: withOrg.tokenLabel,
        orgFromHeader: Boolean(auth.orgId),
      });
      return { auth: withOrg };
    }
    // local-dev: allow default org fill-in from DB
    const withOrg = await withDefaultOrg(auth);
    return { auth: withOrg };
  }

  const githubUserId =
    typeof auth.githubUserId === "number"
      ? auth.githubUserId
      : parseGithubUserIdFromAuth(auth.userId);
  if (typeof githubUserId !== "number") {
    return { status: 403, error: "Forbidden" };
  }

  let orgId = auth.orgId;
  if (!orgId) {
    // CLI never sends X-Org-Id; resolve from membership or personal install.
    const resolved = await resolveOrgIdForGithubUser(
      githubUserId,
      auth.githubUserLogin,
    );
    if (!resolved) {
      return {
        status: 403,
        error: "Install the GX GitHub App to continue",
      };
    }
    orgId = resolved;
  } else {
    const member = await requireOrgMembership(orgId, githubUserId);
    if (!member) {
      const healed = await healPersonalInstallMembership(
        orgId,
        githubUserId,
        auth.githubUserLogin,
      );
      if (!healed) {
        return { status: 403, error: "Forbidden" };
      }
    }
  }

  return {
    auth: {
      ...auth,
      orgId,
      githubUserId,
    },
  };
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

  const enforced = await enforceOrgMembership(auth);
  if ("error" in enforced) {
    return c.json({ error: enforced.error }, enforced.status);
  }

  c.set("auth", enforced.auth);
  await next();
});
