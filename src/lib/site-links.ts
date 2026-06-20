export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ??
  "https://github.com/satoricorp/gx";

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_URL ?? "https://discord.gg/satori";

export const POST_SIGN_IN_URL = "/onboarding";
export const SIGNED_IN_HOME_URL = "/download";

export const NAV_LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "FAQ", href: "/#faq" },
] as const;
