"use node";

import { createSign } from "node:crypto";

export async function getGithubAppInstallationToken(
  installationId: number,
): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;

  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const tokenResponse = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "console-app",
      },
    },
  );

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(
      `Failed to get installation token (${tokenResponse.status}): ${text}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as { token: string };
  return tokenData.token;
}
