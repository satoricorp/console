/**
 * Audience check for GitHub access tokens handed to Convex.
 *
 * POST /cx/auth/complete is unauthenticated by design — it is where the CLI
 * turns a freshly minted GitHub device-flow token into a gx session. What made
 * it exploitable is that the token was only checked against
 * api.github.com/user, which answers for *any* valid GitHub token. Anyone
 * holding a token for a gx user, from any application at all, could exchange it
 * for a 90-day gxcs_ session as that user.
 *
 * GitHub's check-token API is the missing half: it authenticates with the
 * client secret, so only gx can call it, and it answers only for tokens issued
 * for that client.
 *
 * Mirrors server/src/github/oauth.ts, which guards the same class of token on
 * the Cloud API. The two deploy separately, so they do not share a module.
 *
 * https://docs.github.com/rest/apps/oauth-applications#check-a-token
 */

export type GitHubOAuthClient = {
  /** Which gx client this is, for logs. Never the secret. */
  label: string;
  id: string;
  secret: string;
};

export type GitHubTokenAudience = {
  clientId: string;
  clientLabel: string;
  userId: number;
  userLogin?: string;
};

type CheckTokenResponse = {
  app?: { client_id?: string };
  user?: { id?: number; login?: string };
};

/**
 * The OAuth clients whose tokens count as a gx login.
 *
 * There is one gx OAuth client, GITHUB_CLIENT_ID, used by both the Console's
 * web sign-in and the CLI's device flow.
 *
 * The legacy pair is a migration slot, not a second identity. The CLI bakes its
 * client id into the binary at build time, so binaries built before the two
 * clients were consolidated keep presenting the old one, and a token they
 * obtained is still a genuine gx login. Configure it while those are in the
 * wild and delete it once they have aged out.
 */
export function trustedGitHubOAuthClients(): GitHubOAuthClient[] {
  return [
    {
      label: "gx",
      id: process.env.GITHUB_CLIENT_ID?.trim() || "",
      secret: process.env.GITHUB_CLIENT_SECRET?.trim() || "",
    },
    {
      label: "legacy",
      id: process.env.GX_LEGACY_GITHUB_CLIENT_ID?.trim() || "",
      secret: process.env.GX_LEGACY_GITHUB_CLIENT_SECRET?.trim() || "",
    },
  ].filter((client) => client.id && client.secret);
}

/**
 * Identity behind a GitHub token, or null when it was not issued for a gx
 * OAuth client. Unconfigured credentials mean no token can be verified, and an
 * unverifiable token is refused rather than waved through.
 */
export async function verifyGitHubTokenAudience(
  accessToken: string,
): Promise<GitHubTokenAudience | null> {
  const clients = trustedGitHubOAuthClients();
  if (clients.length === 0) {
    console.error(
      "GitHub tokens rejected: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not configured",
    );
    return null;
  }

  for (const client of clients) {
    const audience = await checkTokenForClient(client, accessToken);
    if (audience) {
      return audience;
    }
  }
  return null;
}

async function checkTokenForClient(
  client: GitHubOAuthClient,
  accessToken: string,
): Promise<GitHubTokenAudience | null> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(client.id)}/token`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${btoa(`${client.id}:${client.secret}`)}`,
          "Content-Type": "application/json",
          "User-Agent": "gx-cloud",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
  } catch (error) {
    console.error("GitHub check-token request failed", {
      client: client.label,
      error,
    });
    return null;
  }

  // 404 is the ordinary answer for a token belonging to another application,
  // and 422 for one GitHub will not parse. Both mean "not ours".
  if (response.status === 404 || response.status === 422) {
    return null;
  }
  if (response.status === 401) {
    console.error("GitHub check-token rejected our client credentials", {
      client: client.label,
    });
    return null;
  }
  if (!response.ok) {
    console.error("GitHub check-token failed", {
      client: client.label,
      status: response.status,
    });
    return null;
  }

  let payload: CheckTokenResponse;
  try {
    payload = (await response.json()) as CheckTokenResponse;
  } catch {
    return null;
  }

  const userId = payload.user?.id;
  if (typeof userId !== "number") {
    return null;
  }
  // GitHub echoes the client the token belongs to; a mismatch would mean the
  // answer describes some other application's token.
  if (payload.app?.client_id && payload.app.client_id !== client.id) {
    console.error("GitHub check-token answered for a different client", {
      client: client.label,
    });
    return null;
  }

  return {
    clientId: client.id,
    clientLabel: client.label,
    userId,
    userLogin: payload.user?.login,
  };
}
