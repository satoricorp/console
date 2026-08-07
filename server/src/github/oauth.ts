/**
 * Audience check for inbound GitHub access tokens.
 *
 * A GitHub token is not by itself a gx credential. `GET api.github.com/user`
 * answers for *any* valid token, so a 200 there only proves the caller holds
 * some GitHub token for that user — one minted by any third-party app the user
 * ever authorized, or by an app the attacker controls and talked them into
 * signing in to. Treating that as proof of a gx login let such a token act as
 * its GitHub user against this API.
 *
 * GitHub's check-token API answers the question that actually matters: was
 * this token issued for one of *our* OAuth clients? It authenticates with the
 * client secret, so only gx can ask it, and it returns 404 for a token that
 * belongs to a different application.
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
 * Identity behind a GitHub token, or null when the token was not issued for the
 * gx OAuth client (including when no client credentials are configured — an
 * unverifiable token is refused, never waved through).
 */
export async function verifyGitHubTokenAudience(
  token: string,
): Promise<GitHubTokenAudience | null> {
  const client = gxOAuthClient();
  if (!client) {
    console.error(
      "GitHub bearer tokens rejected: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not configured",
    );
    return null;
  }
  return checkTokenForClient(client, token);
}

async function checkTokenForClient(
  client: GitHubOAuthClient,
  token: string,
): Promise<GitHubTokenAudience | null> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(client.id)}/token`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${basicAuth(client.id, client.secret)}`,
          "Content-Type": "application/json",
          "User-Agent": "gx-cloud",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: token }),
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

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}
