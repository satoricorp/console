// forwardToConvex hands the delivery on to the Convex indexer.
//
// A GitHub App has exactly one webhook URL, and this server is it. The only
// thing that indexes repository source lives in Convex, behind
// /cx/github/webhook, so until this forward existed that indexer received
// nothing: `handlePush` writes push metadata and hunk links, never file
// contents. The result was that no repository was ever re-indexed on merge.
//
// installation and installation_repositories go with it because Convex has no
// org table of its own: it learns which org owns an installation from these
// deliveries, and a push repairs the mapping if one was ever missed.
//
// The delivery is forwarded verbatim — same bytes, same signature header — so
// Convex verifies exactly what GitHub signed rather than trusting this server.
// A failure here must not fail the delivery back to GitHub: the metadata work
// has already succeeded, and GitHub's retry would repeat it.
export async function forwardToConvex(
  event: string,
  payload: string,
  signature: string | undefined,
  orgId: string | null,
) {
  const base = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  if (!base || !signature) {
    // Worth saying out loud. With CONVEX_SITE_URL unset this returns quietly on
    // every delivery, and the symptom is not an error anywhere — it is that no
    // repository is ever indexed and reviews are thinner than they should be.
    console.warn("convex forward skipped", {
      event,
      reason: base ? "missing signature" : "CONVEX_SITE_URL is not set",
    });
    return;
  }
  try {
    const response = await fetch(`${base}/cx/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-Hub-Signature-256": signature,
        // Postgres owns installation -> org. Convex indexes into
        // gx-{orgId}-{repo}, and deriving the org there independently is how
        // the two would come to disagree about who owns an installation.
        ...(orgId ? { "X-GX-Org-Id": orgId } : {}),
      },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("forward to convex failed", { event,
        status: response.status,
        body: (await response.text().catch(() => "")).slice(0, 500),
      });
    }
  } catch (error) {
    console.error("forward to convex threw", { event, error });
  }
}
