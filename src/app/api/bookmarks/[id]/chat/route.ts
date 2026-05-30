import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { gxApiJson } from "@/lib/gx-api-server";
import { prChatContextFromBookmark } from "@/lib/bookmark-action-context";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";
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
    const bookmark = await gxApiJson<ConsoleBookmark>(
      user._id,
      `/bookmarks/${encodeURIComponent(bookmarkId)}?include_payload=1`,
    );
    if (!bookmark.payload) {
      return Response.json(
        { error: "Bookmark not found or missing payload. Run gx pr to sync." },
        { status: 404 },
      );
    }

    const chatContext = prChatContextFromBookmark(
      bookmark,
      bookmark.payload,
      body.pins ?? [],
    );

    const response = await fetchAuthAction(api.prChatActions.sendMessage, {
      bookmarkId,
      message: body.message,
      history: body.history ?? [],
      pins: body.pins,
      repoFullName: chatContext.repoFullName,
      branchName: chatContext.branchName,
      title: chatContext.title,
      prChatContext: chatContext.prChatContext,
    });

    return Response.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send chat message";
    return Response.json({ error: message }, { status: 503 });
  }
}
