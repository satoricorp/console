import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";
import { gxApiJson } from "@/lib/gx-api-server";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const includePayload =
    new URL(request.url).searchParams.get("include_payload") === "1";

  try {
    const path = includePayload
      ? `/bookmarks/${encodeURIComponent(bookmarkId)}?include_payload=1`
      : `/bookmarks/${encodeURIComponent(bookmarkId)}`;
    const bookmark = await gxApiJson<ConsoleBookmark>(user._id, path);
    return Response.json(bookmark);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load bookmark";
    const status = message === "Not found" ? 404 : 503;
    return Response.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const body = (await request.json()) as { title?: string };
  if (typeof body.title !== "string") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const updated = await gxApiJson<{ id: string; title: string; updatedAtMs: number }>(
      user._id,
      `/bookmarks/${encodeURIComponent(bookmarkId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: body.title }),
      },
    );
    return Response.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update bookmark title";
    const status = message === "Bookmark not found" ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
