import { createMiddleware } from "hono/factory";
import { getSql } from "../db";
import { verifyGitHubTokenAudience } from "../github/oauth";
import {
  healPersonalInstallMembership,
  parseGithubUserIdFromAuth,
  requireOrgMembership,
  resolveOrgIdForGithubUser,
} from "../orgs/members";
import type { AuthContext } from "../types";
import { TtlCache } from "./ttl-cache";

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

type CliSessionVerifyResponse = {
  session_id?: string;
  user_id?: string;
  github_user_id?: number;
  github_login?: string;
  machine_id?: string;
};

/**
 * Verified GitHub identities, cached for a few minutes.
 *
 * The cached value is an authorization decision, so both bounds matter. Without
 * an expiry, a token the user revoked at GitHub — or one whose owner was
 * removed from the org — keeps authorizing requests until the task restarts,
 * which on a long-lived ECS task is indefinitely. Without a ceiling, every
 * distinct token the process ever sees is retained for its lifetime. Five
 * minutes still absorbs the burst of calls a single CLI command makes.
 */
const GITHUB_AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_AUTH_CACHE_MAX_ENTRIES = 1000;

let githubAuthCacheNow: () => number = () => Date.now();

const githubAuthCache = new TtlCache<AuthContext>({
  ttlMs: GITHUB_AUTH_CACHE_TTL_MS,
  maxEntries: GITHUB_AUTH_CACHE_MAX_ENTRIES,
  now: () => githubAuthCacheNow(),
});

/** Test-only seam (mirrors setOrgMemberCheckForTests). Clears the cache too. */
export function setGithubAuthCacheClockForTests(now: (() => number) | null): void {
  githubAuthCacheNow = now ?? (() => Date.now());
  githubAuthCache.clear();
}

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

/**
 * A raw GitHub access token used as a gx bearer.
 *
 * The token has to have been issued for one of gx's own OAuth clients. This
 * used to accept anything api.github.com/user would answer for, which is every
 * valid GitHub token in existence: a token minted by any other app the user had
 * authorized — or by an app the attacker runs — authenticated as that user
 * here. verifyGitHubTokenAudience asks GitHub whose application the token
 * belongs to, which is the part that makes it a gx credential.
 */
async function resolveGitHubToken(
  token: string,
  orgIdHeader: string | undefined,
): Promise<AuthContext | null> {
  const orgId = orgIdHeader?.trim() || "";
  const cacheKey = `${orgId}:${token}`;
  const cached = githubAuthCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const audience = await verifyGitHubTokenAudience(token);
  if (!audience) {
    return null;
  }

  const auth: AuthContext = {
    orgId,
    userId: `github:${audience.userId}`,
    tokenLabel: audience.userLogin ? `github:${audience.userLogin}` : "github",
    githubUserId: audience.userId,
    githubUserLogin: audience.userLogin,
  };
  githubAuthCache.set(cacheKey, auth);
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

/**
 * Auth that came from a server-side secret rather than an end user: the Console
 * BFF's GX_CLOUD_API_KEY and the local-dev bypass. Neither carries a GitHub
 * identity to check org membership against, so routes that authorize a user
 * against an org exempt them and rely on the caller's own access checks.
 */
export function isTrustedInfraAuth(auth: AuthContext): boolean {
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
        error: "Install the gx GitHub App to continue",
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
