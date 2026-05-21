const convexSiteUrl = () =>
  process.env.CONVEX_SITE_URL?.replace(/\/$/, "") ?? "";

export async function shouldIndexRepo(fullName: string): Promise<boolean> {
  const callbackSecret = process.env.TURBO_PUFFER_CALLBACK_SECRET;
  const siteUrl = convexSiteUrl();

  if (!callbackSecret || !siteUrl) {
    return true;
  }

  const response = await fetch(`${siteUrl}/turbo-puffer/should-index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${callbackSecret}`,
    },
    body: JSON.stringify({ fullName }),
  });

  if (!response.ok) {
    console.warn(`should-index check failed for ${fullName}`);
    return false;
  }

  const body = (await response.json()) as { shouldIndex: boolean };
  return body.shouldIndex;
}
