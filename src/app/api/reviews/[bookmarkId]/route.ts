import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { txApiRequest } from "@/lib/tx-api-server";

async function requireViewerId(): Promise<string | null> {
  const viewer = await fetchAuthQuery(api.profile.getViewer, {});
  return viewer?.id ?? null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookmarkId: string }> },
) {
  const viewerId = await requireViewerId();
  if (!viewerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookmarkId } = await context.params;
  const upstream = await txApiRequest(viewerId, `/v1/reviews/${bookmarkId}`);
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
