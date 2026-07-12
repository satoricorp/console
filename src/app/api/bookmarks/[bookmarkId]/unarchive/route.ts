import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { gxApiRequest } from "@/lib/gx-api-server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ bookmarkId: string }> },
) {
  const viewer = await fetchAuthQuery(api.profile.getViewer, {});
  if (!viewer?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookmarkId } = await context.params;
  const upstream = await gxApiRequest(
    viewer.id,
    `/bookmarks/${encodeURIComponent(bookmarkId)}/unarchive`,
    { method: "POST" },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
