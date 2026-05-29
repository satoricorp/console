"use client";

import { useAction, useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import { chatPinToInput, formatChatPinLabel, type ChatPin } from "@/lib/chat-pin";
import {
  isMoveSelectionEmpty,
  toSplitToChangeRequest,
} from "@/lib/move-selection";
import { usePrReviewWorkspace } from "./pr-review-workspace";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pins?: ChatPin[];
  sources?: Array<{
    file_path: string;
    symbol?: string;
  }>;
};

function PinBadge({
  pin,
  onRemove,
}: {
  pin: ChatPin;
  onRemove?: () => void;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-xs ${
        onRemove
          ? "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          : "border-zinc-600 bg-zinc-800 text-zinc-200 dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-800"
      }`}
      title={pin.text}
    >
      <span className="truncate font-medium">{pin.label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          aria-label={`Remove ${pin.label}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function titleForBookmark(bookmark: { title?: string; branchName: string }) {
  return bookmark.title?.trim() || bookmark.branchName;
}

export function PrChatPanel() {
  const {
    bookmark,
    chatPins,
    moveSelection,
    allowedMoveFiles,
    removeChatPin,
    clearChatPins,
    completeMoveToOwnChange,
    collapseChat,
    chatDraft,
    updateChatDraft,
  } = usePrReviewWorkspace();
  const sendMessage = useAction(api.prChatActions.sendMessage);
  const connectedRepos = useQuery(api.repos.getMyConnectedRepos);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRevisionRef = useRef(bookmark.revision);

  const indexStatus =
    connectedRepos?.find((repo) => repo.fullName === bookmark.repoFullName)
      ?.indexStatus ?? null;

  const canMove =
    moveSelection != null &&
    !isMoveSelectionEmpty(moveSelection) &&
    allowedMoveFiles.length > 0;

  const handleMoveToOwnChange = useCallback(async () => {
    if (!moveSelection || !canMove || isMoving) return;

    setMoveError(null);
    setIsMoving(true);
    try {
      const request = toSplitToChangeRequest(
        moveSelection,
        chatDraft.trim() || "Split from review",
        allowedMoveFiles,
      );
      const response = await fetch(
        `/api/bookmarks/${encodeURIComponent(bookmark.id)}/split-to-change`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jjChangeId: request.jjChangeId,
            description: request.description,
            filePaths: request.filePaths,
            lineRanges: request.lineRanges,
          }),
        },
      );

      type SplitResponse = {
        newJjChangeId?: string | null;
        error?: string;
      };

      let result: SplitResponse;
      try {
        result = (await response.json()) as SplitResponse;
      } catch {
        throw new Error(`Split request failed (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(result.error ?? `Split failed (${response.status})`);
      }

      completeMoveToOwnChange(result.newJjChangeId ?? undefined);
    } catch (moveFailure) {
      setMoveError(
        moveFailure instanceof Error
          ? moveFailure.message
          : "Failed to move to own change.",
      );
    } finally {
      setIsMoving(false);
    }
  }, [
    allowedMoveFiles,
    bookmark.id,
    canMove,
    chatDraft,
    isMoving,
    moveSelection,
    completeMoveToOwnChange,
  ]);

  useEffect(() => {
    if (lastRevisionRef.current !== bookmark.revision) {
      lastRevisionRef.current = bookmark.revision;
      setMessages((current) => [
        ...current,
        {
          id: `system-${bookmark.revision}`,
          role: "assistant",
          content:
            "This PR was updated with a new gx pr push. Ask again if you want answers based on the latest changes.",
        },
      ]);
    }
  }, [bookmark.revision]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  async function submitMessage() {
    const trimmed = chatDraft.trim();
    if (!trimmed || isSending) return;

    const attachedPins =
      chatPins.length > 0 ? chatPins.map((pin) => ({ ...pin })) : undefined;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      pins: attachedPins,
    };

    updateChatDraft("");
    setError(null);
    setIsSending(true);
    setMessages((current) => [...current, userMessage]);
    if (attachedPins) {
      clearChatPins();
    }

    try {
      const history = [...messages, userMessage]
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      const response = await sendMessage({
        bookmarkId: bookmark.id,
        message: trimmed,
        history: history.slice(0, -1),
        pins: attachedPins?.map(chatPinToInput),
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.reply,
          sources: response.sources.map((source) => ({
            file_path: source.file_path,
            symbol: source.symbol,
          })),
        },
      ]);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "Failed to send message.",
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSend(event: React.FormEvent) {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submitMessage();
    }
  }

  const indexHint =
    indexStatus === "ready"
      ? null
      : indexStatus === "indexing" || indexStatus === "pending"
        ? "Repository indexing is still running. Answers may be incomplete until indexing finishes."
        : indexStatus === "failed"
          ? "Repository indexing failed. Connect the repo again or retry indexing."
          : "Connect and index this repository to search its code.";

  return (
    <aside className="flex max-h-[calc(100dvh-12rem)] w-full shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:sticky lg:top-6 lg:h-[calc(100dvh-12rem)] lg:w-96">
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              PR chat
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {bookmark.repoFullName} · {titleForBookmark(bookmark)}
            </p>
            {indexHint ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {indexHint}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={collapseChat}
            className="hidden shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 lg:block"
            aria-label="Hide chat"
            title="Hide chat"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Ask about this PR, its diffs, or the agent sessions captured by{" "}
            <code className="text-xs">gx pr</code>. Select lines in the diff to
            leave an inline comment, or use Pin to chat from the comment draft.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-md px-3 py-2 text-sm ${
                message.role === "user"
                  ? "ml-6 bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "mr-6 border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              }`}
            >
              {message.pins && message.pins.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {message.pins.map((pin) => (
                    <PinBadge key={`${message.id}-${pin.id}`} pin={pin} />
                  ))}
                </div>
              ) : null}
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.sources && message.sources.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                  {message.sources.slice(0, 4).map((source, index) => (
                    <li key={`${message.id}-source-${index}`}>
                      {source.file_path}
                      {source.symbol ? ` · ${source.symbol}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
        {isSending ? (
          <p className="text-xs text-zinc-500">Searching repo and drafting reply…</p>
        ) : null}
      </div>

      <form
        onSubmit={handleSend}
        className="shrink-0 border-t border-zinc-200 p-4 dark:border-zinc-800"
      >
        {chatPins.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {chatPins.map((pin) => (
              <PinBadge
                key={pin.id}
                pin={pin}
                onRemove={() => removeChatPin(pin.id)}
              />
            ))}
          </div>
        ) : null}
        {canMove && moveSelection ? (
          <div className="mb-3 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Move selection
            </p>
            <div className="flex flex-wrap gap-1.5">
              {moveSelection.filePaths.map((filePath) => (
                <span
                  key={`file-${filePath}`}
                  className="inline-flex max-w-full items-center rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                  title={filePath}
                >
                  <span className="truncate font-medium">{filePath}</span>
                </span>
              ))}
              {moveSelection.lineRanges.map((range, index) => (
                <span
                  key={`range-${range.filePath}-${range.startLine}-${index}`}
                  className="inline-flex max-w-full items-center rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                  title={range.excerpt}
                >
                  <span className="truncate font-medium">
                    {formatChatPinLabel(range.filePath, range.startLine, range.endLine)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {moveError ? (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{moveError}</p>
        ) : null}
        {error ? (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <textarea
          value={chatDraft}
          onChange={(event) => updateChatDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Ask about this PR… (⌘↵ to send)"
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          disabled={isSending || isMoving}
        />
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!canMove || isMoving || isSending}
            onClick={() => void handleMoveToOwnChange()}
          >
            {isMoving ? "Moving…" : "Move to own change"}
          </Button>
          <Button type="submit" disabled={isSending || isMoving || !chatDraft.trim()}>
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
