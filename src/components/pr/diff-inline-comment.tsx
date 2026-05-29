"use client";

import type { DiffLineAnnotation } from "@pierre/diffs";
import { useEffect, useRef, useState } from "react";
import type {
  DiffComment,
  DiffCommentAnnotationMeta,
  PendingDiffComment,
} from "@/lib/diff-comment";
import { formatCommentLineLabel } from "@/lib/diff-comment";

const commentSurfaceStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgb(212 212 216)",
  background: "rgb(250 250 250)",
  color: "rgb(24 24 27)",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 13,
  lineHeight: 1.45,
  boxShadow: "0 1px 2px rgb(0 0 0 / 0.06)",
};

const darkCommentSurfaceStyle: React.CSSProperties = {
  ...commentSurfaceStyle,
  border: "1px solid rgb(63 63 70)",
  background: "rgb(24 24 27)",
  color: "rgb(250 250 250)",
};

function usePrefersDark() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function sync() {
      setDark(root.classList.contains("dark") || media.matches);
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  return dark;
}

function actionButtonStyle(variant: "primary" | "ghost", dark: boolean) {
  const base: React.CSSProperties = {
    borderRadius: 6,
    height: 28,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };

  if (variant === "primary") {
    return {
      ...base,
      border: dark ? "1px solid rgb(250 250 250)" : "1px solid rgb(24 24 27)",
      background: dark ? "rgb(250 250 250)" : "rgb(24 24 27)",
      color: dark ? "rgb(24 24 27)" : "rgb(250 250 250)",
    };
  }

  return {
    ...base,
    border: dark ? "1px solid rgb(63 63 70)" : "1px solid rgb(212 212 216)",
    background: "transparent",
    color: dark ? "rgb(250 250 250)" : "rgb(24 24 27)",
  };
}

function isModKey(event: { metaKey: boolean; ctrlKey: boolean }) {
  return event.metaKey || event.ctrlKey;
}

export function DiffCommentDraft({
  pending,
  onSave,
  onCancel,
  onPinToChat,
}: {
  pending: PendingDiffComment;
  onSave: (body: string) => void;
  onCancel: () => void;
  onPinToChat?: (body: string) => void;
}) {
  const dark = usePrefersDark();
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSave() {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  function handlePinToChat() {
    if (!onPinToChat) return;
    onPinToChat(body.trim());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Enter" && isModKey(event)) {
      event.preventDefault();
      if (event.shiftKey) {
        handlePinToChat();
        return;
      }
      handleSave();
    }
  }

  const lineLabel = formatCommentLineLabel(pending.startLine, pending.endLine);
  const modLabel =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? "⌘"
      : "Ctrl";

  return (
    <div style={dark ? darkCommentSurfaceStyle : commentSurfaceStyle}>
      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: dark ? "rgb(161 161 170)" : "rgb(113 113 122)",
        }}
      >
        New comment · {pending.filePath}:{lineLabel}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder={`Leave a comment on these lines… (${modLabel}↵ save, ${modLabel}⇧↵ pin to chat, Esc cancel)`}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          marginBottom: 8,
          padding: 8,
          borderRadius: 6,
          border: dark ? "1px solid rgb(63 63 70)" : "1px solid rgb(212 212 216)",
          background: dark ? "rgb(9 9 11)" : "rgb(255 255 255)",
          color: dark ? "rgb(250 250 250)" : "rgb(24 24 27)",
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      />
      {pending.excerpt ? (
        <pre
          style={{
            margin: "0 0 8px",
            maxHeight: 96,
            overflow: "auto",
            padding: 8,
            borderRadius: 6,
            background: dark ? "rgb(9 9 11)" : "rgb(244 244 245)",
            color: dark ? "rgb(212 212 216)" : "rgb(63 63 70)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}
        >
          {pending.excerpt}
        </pre>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!body.trim()}
          style={{
            ...actionButtonStyle("primary", dark),
            opacity: body.trim() ? 1 : 0.5,
          }}
        >
          Save comment {modLabel}↵
        </button>
        {onPinToChat ? (
          <button
            type="button"
            onClick={handlePinToChat}
            style={actionButtonStyle("ghost", dark)}
          >
            Pin to chat {modLabel}⇧↵
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          style={actionButtonStyle("ghost", dark)}
        >
          Cancel Esc
        </button>
      </div>
    </div>
  );
}

export function DiffCommentBubble({
  comment,
  onDelete,
}: {
  comment: DiffComment;
  onDelete?: (commentId: string) => void;
}) {
  const dark = usePrefersDark();
  const lineLabel = formatCommentLineLabel(comment.startLine, comment.endLine);

  return (
    <div style={dark ? darkCommentSurfaceStyle : commentSurfaceStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: dark ? "rgb(161 161 170)" : "rgb(113 113 122)",
          }}
        >
          Comment · {comment.filePath}:{lineLabel}
        </div>
        {onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            aria-label="Delete comment"
            style={{
              border: "none",
              background: "transparent",
              color: dark ? "rgb(161 161 170)" : "rgb(113 113 122)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <p
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {comment.body}
      </p>
    </div>
  );
}

export function renderDiffCommentAnnotation(
  annotation: DiffLineAnnotation<DiffCommentAnnotationMeta>,
  context: {
    pending: PendingDiffComment | null;
    onSaveDraft: (body: string) => void;
    onCancelDraft: () => void;
    onPinDraftToChat?: (body: string) => void;
    onDeleteComment: (commentId: string) => void;
  },
) {
  if (annotation.metadata.kind === "draft") {
    if (context.pending == null) return null;
    return (
      <DiffCommentDraft
        pending={context.pending}
        onSave={context.onSaveDraft}
        onCancel={context.onCancelDraft}
        onPinToChat={context.onPinDraftToChat}
      />
    );
  }

  return (
    <DiffCommentBubble
      comment={annotation.metadata.comment}
      onDelete={context.onDeleteComment}
    />
  );
}
