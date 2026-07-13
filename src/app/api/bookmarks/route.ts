import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { gxApiRequest } from "@/lib/gx-api-server";

const ALLOWED_STATUS = new Set(["open", "merged", "closed", "archived"]);

export async function GET(request: Request) {
  const viewer = await fetchAuthQuery(api.profile.getViewer, {});
  if (!viewer?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mergeStatus = url.searchParams.get("merge_status")?.trim();
  if (mergeStatus && !ALLOWED_STATUS.has(mergeStatus)) {
    return NextResponse.json({ error: "Invalid merge_status" }, { status: 400 });
  }

  const params = new URLSearchParams();
  if (mergeStatus) params.set("merge_status", mergeStatus);
  const qs = params.toString();
  const upstream = await gxApiRequest(
    viewer.id,
    qs ? `/bookmarks?${qs}` : "/bookmarks",
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
