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

type GitHubOAuthClient = {
  id: string;
  secret: string;
};

export type GitHubTokenAudience = {
  clientId: string;
  userId: number;
  userLogin?: string;
};

type CheckTokenResponse = {
  app?: { client_id?: string };
  user?: { id?: number; login?: string };
};

/**
 * The one gx OAuth client. Both the Console's web sign-in and the CLI's device
 * flow authorize against it, so a token issued for anything else is not a gx
 * login regardless of which GitHub user it names.
 */
function gxOAuthClient(): GitHubOAuthClient | null {
  const id = process.env.GITHUB_CLIENT_ID?.trim() || "";
  const secret = process.env.GITHUB_CLIENT_SECRET?.trim() || "";
  return id && secret ? { id, secret } : null;
}

/**
 * Identity behind a GitHub token, or null when it was not issued for the gx
 * OAuth client. Unconfigured credentials mean no token can be verified, and an
 * unverifiable token is refused rather than waved through.
 */
export async function verifyGitHubTokenAudience(
  accessToken: string,
): Promise<GitHubTokenAudience | null> {
  const client = gxOAuthClient();
  if (!client) {
    console.error(
      "GitHub tokens rejected: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not configured",
    );
    return null;
  }
  return checkTokenForClient(client, accessToken);
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
    console.error("GitHub check-token request failed", { error });
    return null;
  }

  // 404 is the ordinary answer for a token belonging to another application,
  // and 422 for one GitHub will not parse. Both mean "not ours".
  if (response.status === 404 || response.status === 422) {
    return null;
  }
  if (response.status === 401) {
    console.error("GitHub check-token rejected our client credentials");
    return null;
  }
  if (!response.ok) {
    console.error("GitHub check-token failed", { status: response.status });
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
    console.error("GitHub check-token answered for a different client");
    return null;
  }

  return {
    clientId: client.id,
    userId,
    userLogin: payload.user?.login,
  };
}
