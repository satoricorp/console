export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ??
  "https://github.com/satoricorp/tx";

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_URL ?? "https://discord.gg/NJ2aGugtj";

/** Company/product Twitter for now — Joe's handle. */
export const TWITTER_URL =
  process.env.NEXT_PUBLIC_TWITTER_URL ?? "https://x.com/satori_corp";
export const TWITTER_HANDLE = "@satori_corp";

export const SUPPORT_EMAIL = "hi@satori.sh";
export const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;

/** First-time OAuth lands here; completed users are redirected to /reviews. */
export const POST_SIGN_IN_URL = "/download";
/** Returning signed-in users hitting `/` go straight to reviews. */
export const SIGNED_IN_HOME_URL = "/reviews";
export const GITHUB_SIGN_IN_URL = "/api/auth/github";

/** Append `onboarding=1` so the funnel can be replayed. */
export function withOnboardingParam(href: string, forceOnboarding: boolean) {
  if (!forceOnboarding) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("onboarding", "1");
  const next = params.toString();
  return next ? `${path}?${next}` : path;
}

export function githubSignInUrl(callbackURL = POST_SIGN_IN_URL) {
  const params = new URLSearchParams({ callbackURL });
  return `${GITHUB_SIGN_IN_URL}?${params.toString()}`;
}

export const DOCS_URL = "/docs";

export const HOW_IT_WORKS_DOCS_URL = "https://gx.run/docs/how-it-works";

export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "FAQ", href: "/#faq" },
  { label: "Documentation", href: DOCS_URL },
];
