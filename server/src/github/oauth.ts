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
 * gx has two, and they are different applications: the Console's web sign-in
 * and the CLI's device flow. A token is accepted if it was issued for either,
 * so both pairs have to be configured for both login paths to keep working.
 */
export function trustedGitHubOAuthClients(): GitHubOAuthClient[] {
  return [
    {
      label: "console",
      id: process.env.GITHUB_CLIENT_ID?.trim() || "",
      secret: process.env.GITHUB_CLIENT_SECRET?.trim() || "",
    },
    {
      label: "cli",
      id: process.env.GX_CLI_GITHUB_CLIENT_ID?.trim() || "",
      secret: process.env.GX_CLI_GITHUB_CLIENT_SECRET?.trim() || "",
    },
  ].filter((client) => client.id && client.secret);
}

/**
 * Identity behind a GitHub token, or null when the token was not issued for a
 * gx OAuth client (including when no client credentials are configured — an
 * unverifiable token is refused, never waved through).
 */
export async function verifyGitHubTokenAudience(
  token: string,
): Promise<GitHubTokenAudience | null> {
  const clients = trustedGitHubOAuthClients();
  if (clients.length === 0) {
    console.error(
      "GitHub bearer tokens rejected: no GitHub OAuth client credentials are configured " +
        "(GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET, GX_CLI_GITHUB_CLIENT_ID/GX_CLI_GITHUB_CLIENT_SECRET)",
    );
    return null;
  }

  for (const client of clients) {
    const audience = await checkTokenForClient(client, token);
    if (audience) {
      return audience;
    }
  }
  return null;
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

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}
