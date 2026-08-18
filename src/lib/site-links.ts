import { REVIEWS_ENABLED } from "@/lib/feature-flags";

export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ??
  "https://github.com/satoricorp/gx";

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_URL ?? "https://discord.gg/NJ2aGugtj";

/** Company/product Twitter for now — Joe's handle. */
export const TWITTER_URL =
  process.env.NEXT_PUBLIC_TWITTER_URL ?? "https://x.com/satori_corp";
export const TWITTER_HANDLE = "@satori_corp";

export const SUPPORT_EMAIL = "joe@satori.sh";
export const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;

/** Founder booking link behind the landing CTA. */
export const FOUNDER_CALL_URL =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ??
  "https://cal.com/meet-with-satori/15min";

/** First-time OAuth lands here; completed users are redirected to the app home. */
export const POST_SIGN_IN_URL = "/download";
/**
 * Returning signed-in users hitting `/` go straight to reviews — unless the
 * reviews surface is flagged off, in which case repositories is the app home.
 */
export const SIGNED_IN_HOME_URL = REVIEWS_ENABLED ? "/reviews" : "/repositories";
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

export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { label: "Documentation", href: DOCS_URL },
];
