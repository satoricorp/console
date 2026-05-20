export type JobStatusPayload = {
  fullName: string;
  status: "pending" | "indexing" | "ready" | "failed";
  commitId?: string;
  filesTotal?: number;
  filesIndexed?: number;
  chunksIndexed?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  defaultBranch?: string;
};

export async function reportJobStatus(payload: JobStatusPayload) {
  const callbackSecret = process.env.TURBO_PUFFER_CALLBACK_SECRET;
  if (!callbackSecret) {
    console.warn("TURBO_PUFFER_CALLBACK_SECRET not set — skipping callback");
    return;
  }

  const callbackUrl =
    process.env.CONVEX_CALLBACK_URL ??
    (process.env.CONVEX_SITE_URL
      ? `${process.env.CONVEX_SITE_URL.replace(/\/$/, "")}/turbo-puffer/callback`
      : null);

  if (!callbackUrl) {
    console.warn("CONVEX_SITE_URL not set — skipping callback");
    return;
  }

  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${callbackSecret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Job status callback failed (${response.status}): ${body}`);
  }
}
