export type GitHubProfile = {
  id: number | string;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

export type GitHubEmail = {
  email: string;
  primary?: boolean;
  verified?: boolean;
};

type GitHubAuthToken = {
  accessToken?: string;
};

type ResolvedGitHubEmail = {
  email: string;
  emailVerified: boolean;
};

export async function githubFetch<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gx-cloud",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function resolveGitHubEmail(
  profile: GitHubProfile,
  emails: readonly GitHubEmail[] = [],
): ResolvedGitHubEmail {
  const primaryVerifiedEmail = emails.find(
    (entry) => entry.primary && entry.verified && entry.email.trim(),
  );
  if (primaryVerifiedEmail) {
    return { email: primaryVerifiedEmail.email, emailVerified: true };
  }

  const verifiedEmail = emails.find(
    (entry) => entry.verified && entry.email.trim(),
  );
  if (verifiedEmail) {
    return { email: verifiedEmail.email, emailVerified: true };
  }

  const primaryEmail = emails.find(
    (entry) => entry.primary && entry.email.trim(),
  );
  if (primaryEmail) {
    return {
      email: primaryEmail.email,
      emailVerified: primaryEmail.verified ?? false,
    };
  }

  const firstEmail = emails.find((entry) => entry.email.trim());
  if (firstEmail) {
    return {
      email: firstEmail.email,
      emailVerified: firstEmail.verified ?? false,
    };
  }

  const profileEmail = profile.email?.trim();
  if (profileEmail) {
    return {
      email: profileEmail,
      emailVerified: false,
    };
  }

  console.warn(
    "GitHub did not return an email; using canonical noreply fallback",
    { githubUserId: profile.id, githubLogin: profile.login },
  );

  return {
    email: `${profile.id}+${profile.login}@users.noreply.github.com`,
    emailVerified: false,
  };
}

export async function getBetterAuthGitHubUserInfo(token: GitHubAuthToken) {
  if (!token.accessToken) {
    return null;
  }

  const profile = await githubFetch<GitHubProfile>(
    "https://api.github.com/user",
    token.accessToken,
  );

  if (!profile.id || !profile.login) {
    return null;
  }

  let emails: GitHubEmail[] = [];
  try {
    emails = await githubFetch<GitHubEmail[]>(
      "https://api.github.com/user/emails",
      token.accessToken,
    );
  } catch {
    // Some GitHub app/user-token configurations cannot read private emails.
  }

  const resolvedEmail = resolveGitHubEmail(profile, emails);
  const name = profile.name?.trim() || profile.login;
  const image = profile.avatar_url ?? undefined;

  return {
    user: {
      id: String(profile.id),
      name,
      email: resolvedEmail.email,
      image,
      emailVerified: resolvedEmail.emailVerified,
      username: profile.login,
      displayUsername: profile.login,
    },
    data: {
      ...profile,
      email: resolvedEmail.email,
    },
  };
}
