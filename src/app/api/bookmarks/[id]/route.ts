import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { getToken } from "@/lib/auth-server";
import { loadBookmarkPayload } from "@/lib/local-postgres";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const includePayload =
    new URL(request.url).searchParams.get("include_payload") === "1";

  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);

  const meta = await client.query(api.gxPr.getConsoleBookmarkDetail, { bookmarkId });

  if (!meta) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!includePayload) {
    return Response.json(meta);
  }

  try {
    const payload = await loadBookmarkPayload(bookmarkId);
    return Response.json({ ...meta, payload: payload ?? undefined });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load bookmark payload";
    return Response.json({ error: message }, { status: 503 });
  }
}
