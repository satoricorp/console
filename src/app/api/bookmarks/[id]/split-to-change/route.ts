import { api } from "../../../../../../convex/_generated/api";
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";

function gxCloudApiUrl(): string {
  return (process.env.GX_CLOUD_API_URL ?? "http://localhost:3200").replace(/\/$/, "");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await fetchAuthQuery(api.auth.getAuthUser);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return Response.json(
      { error: "GX_WEBHOOK_SECRET is not configured on the Next.js server" },
      { status: 500 },
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${gxCloudApiUrl()}/bookmarks/${encodeURIComponent(id)}/split-to-change`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GX-User-Id": user._id,
          "X-GX-Webhook-Secret": webhookSecret,
        },
        body: JSON.stringify(body),
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return Response.json(
        { error: `gx-cloud returned invalid JSON (${response.status})` },
        { status: 502 },
      );
    }

    return Response.json(payload, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach gx-cloud API";
    return Response.json(
      {
        error: `${message}. Is gx-cloud running at ${gxCloudApiUrl()}?`,
      },
      { status: 502 },
    );
  }
}
