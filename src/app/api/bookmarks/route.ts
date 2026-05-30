import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import { gxApiJson } from "@/lib/gx-api-server";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";

export async function GET(request: Request) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mergeStatusParam = new URL(request.url).searchParams.get("merge_status");
  const mergeStatus =
    mergeStatusParam === "open" ||
    mergeStatusParam === "merged" ||
    mergeStatusParam === "closed"
      ? mergeStatusParam
      : undefined;

  try {
    const path = mergeStatus
      ? `/bookmarks?merge_status=${mergeStatus}`
      : "/bookmarks";
    const bookmarks = await gxApiJson<ConsoleBookmark[]>(user._id, path);
    return Response.json(bookmarks);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load bookmarks";
    return Response.json({ error: message }, { status: 503 });
  }
}
