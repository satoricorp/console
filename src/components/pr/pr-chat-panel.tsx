"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import { chatPinToInput, type ChatPin } from "@/lib/chat-pin";

type BookmarkForChat = {
  id: string;
  repoFullName: string;
  branchName: string;
  title?: string;
  revision: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    file_path: string;
    symbol?: string;
  }>;
};

type PrChatPanelProps = {
  bookmark: BookmarkForChat;
  pins: ChatPin[];
  onRemovePin: (pinId: string) => void;
};

function titleForBookmark(bookmark: BookmarkForChat) {
  return bookmark.title?.trim() || bookmark.branchName;
}

export function PrChatPanel({ bookmark, pins, onRemovePin }: PrChatPanelProps) {
  const sendMessage = useAction(api.prChatActions.sendMessage);
  const connectedRepos = useQuery(api.repos.getMyConnectedRepos);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRevisionRef = useRef(bookmark.revision);

  const indexStatus =
    connectedRepos?.find((repo) => repo.fullName === bookmark.repoFullName)
      ?.indexStatus ?? null;

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setError(null);
    lastRevisionRef.current = bookmark.revision;
  }, [bookmark.id]);

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
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    setDraft("");
    setError(null);
    setIsSending(true);
    setMessages((current) => [...current, userMessage]);

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
        pins: pins.length > 0 ? pins.map(chatPinToInput) : undefined,
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

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Ask about this PR, its diffs, or the agent sessions captured by{" "}
            <code className="text-xs">gx pr</code>. Select lines in the diff and
            click <span className="font-medium">Add to chat</span> to pin code
            context.
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
        {pins.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {pins.map((pin) => (
              <span
                key={pin.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                title={pin.text}
              >
                <span className="truncate font-medium">{pin.label}</span>
                <button
                  type="button"
                  onClick={() => onRemovePin(pin.id)}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  aria-label={`Remove ${pin.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Ask about this PR… (⌘↵ to send)"
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          disabled={isSending}
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" disabled={isSending || !draft.trim()}>
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
