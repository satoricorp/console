import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { loadBookmarkChatContext } from "@/lib/local-postgres";
import type { ChatPin } from "@/lib/chat-pin";

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const body = (await request.json()) as {
    message?: string;
    history?: ChatHistoryMessage[];
    pins?: ChatPin[];
  };

  if (typeof body.message !== "string" || !body.message.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const bookmark = await loadBookmarkChatContext(user._id, bookmarkId);
    if (!bookmark) {
      return Response.json(
        { error: "Bookmark not found or missing payload. Run gx pr to sync." },
        { status: 404 },
      );
    }

    const response = await fetchAuthAction(api.prChatActions.sendMessage, {
      bookmarkId,
      message: body.message,
      history: body.history ?? [],
      pins: body.pins,
      payload: bookmark.payload,
      repoFullName: bookmark.repoFullName,
      branchName: bookmark.branchName,
      title: bookmark.title,
    });

    return Response.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send chat message";
    return Response.json({ error: message }, { status: 503 });
  }
}
