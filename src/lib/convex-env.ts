const CONVEX_CLOUD_SUFFIX = ".convex.cloud";
const CONVEX_SITE_SUFFIX = ".convex.site";

type ConvexEnv = Record<string, string | undefined>;

export function resolveConvexSiteUrl(
  env: ConvexEnv = process.env,
): string | undefined {
  const explicitSiteUrl =
    readUrl(env.NEXT_PUBLIC_CONVEX_SITE_URL) ?? readUrl(env.CONVEX_SITE_URL);
  if (explicitSiteUrl) {
    return explicitSiteUrl;
  }

  const convexUrl =
    readUrl(env.NEXT_PUBLIC_CONVEX_URL) ?? readUrl(env.CONVEX_URL);
  if (convexUrl?.endsWith(CONVEX_CLOUD_SUFFIX)) {
    return `${convexUrl.slice(0, -CONVEX_CLOUD_SUFFIX.length)}${CONVEX_SITE_SUFFIX}`;
  }

  return undefined;
}

export function requireConvexSiteUrl(env: ConvexEnv = process.env): string {
  const siteUrl = resolveConvexSiteUrl(env);
  if (!siteUrl) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_SITE_URL or CONVEX_SITE_URL must be set, or NEXT_PUBLIC_CONVEX_URL must be a .convex.cloud URL.",
    );
  }
  return siteUrl;
}

function readUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}
