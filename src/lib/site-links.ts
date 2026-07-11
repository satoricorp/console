export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ??
  "https://github.com/satoricorp/gx";

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_URL ?? "https://discord.gg/NJ2aGugtj";

/** Company/product Twitter for now — Joe's handle. */
export const TWITTER_URL =
  process.env.NEXT_PUBLIC_TWITTER_URL ?? "https://x.com/jlchnc";
export const TWITTER_HANDLE = "@jlchnc";

export const SUPPORT_EMAIL = "hi@satori.sh";
export const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;

export const POST_SIGN_IN_URL = "/download";
export const SIGNED_IN_HOME_URL = "/download";
export const GITHUB_SIGN_IN_URL = "/api/auth/github";

export function githubSignInUrl(callbackURL = POST_SIGN_IN_URL) {
  const params = new URLSearchParams({ callbackURL });
  return `${GITHUB_SIGN_IN_URL}?${params.toString()}`;
}

export const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.gx.run";

export const HOW_IT_WORKS_DOCS_URL = `${DOCS_URL}/how-it-works/overview`;

export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "FAQ", href: "/#faq" },
  { label: "Documentation", href: DOCS_URL, external: true },
];
