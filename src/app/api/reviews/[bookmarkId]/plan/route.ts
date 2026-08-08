import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { REVIEWS_ENABLED } from "@/lib/feature-flags";
import { gxApiRequest } from "@/lib/gx-api-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookmarkId: string }> },
) {
  if (!REVIEWS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewer = await fetchAuthQuery(api.profile.getViewer, {});
  if (!viewer?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookmarkId } = await context.params;
  const payload = await request.text();
  const upstream = await gxApiRequest(viewer.id, `/v1/reviews/${bookmarkId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload || "{}",
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
