"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { stackChangeFromPayload } from "@/lib/gx-stack";
import { type ChatPin } from "@/lib/chat-pin";
import { type DiffComment, type PendingDiffComment } from "@/lib/diff-comment";
import {
  buildMoveSelection,
  pathsEqual,
  type MoveSelection,
} from "@/lib/move-selection";

type ReviewWorkspaceBookmark = {
  id: string;
  repoFullName: string;
  branchName: string;
  title?: string;
  revision: number;
  payload?: unknown;
};

type PrReviewWorkspaceValue = {
  bookmark: ReviewWorkspaceBookmark;
  chatPins: ChatPin[];
  diffComments: DiffComment[];
  pendingComment: PendingDiffComment | null;
  chatDraft: string;
  chatCollapsed: boolean;
  moveSelection: MoveSelection | null;
  allowedMoveFiles: string[];
  addChatPin: (pin: ChatPin) => void;
  removeChatPin: (pinId: string) => void;
  clearChatPins: () => void;
  beginComment: (pending: PendingDiffComment) => void;
  saveComment: (comment: DiffComment) => void;
  cancelComment: () => void;
  deleteComment: (commentId: string) => void;
  pinToChat: (pin: ChatPin, message: string) => void;
  reportFileSelection: (paths: string[]) => void;
  selectChange: (jjChangeId: string | null) => void;
  completeMoveToOwnChange: (newJjChangeId?: string) => void;
  updateChatDraft: (draft: string) => void;
  collapseChat: () => void;
  expandChat: () => void;
};

const PrReviewWorkspaceContext =
  createContext<PrReviewWorkspaceValue | null>(null);

export function PrReviewWorkspaceProvider({
  bookmark,
  children,
}: {
  bookmark: ReviewWorkspaceBookmark;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [chatPins, setChatPins] = useState<ChatPin[]>([]);
  const [diffComments, setDiffComments] = useState<DiffComment[]>([]);
  const [pendingComment, setPendingComment] =
    useState<PendingDiffComment | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [selectedJjChangeId, setSelectedJjChangeId] = useState<string | null>(
    null,
  );

  const moveSelection = useMemo(
    () => buildMoveSelection(selectedJjChangeId, selectedFilePaths, chatPins),
    [chatPins, selectedFilePaths, selectedJjChangeId],
  );

  const allowedMoveFiles = useMemo(() => {
    if (!bookmark.payload || !selectedJjChangeId) return [];
    const change = stackChangeFromPayload(bookmark.payload, selectedJjChangeId);
    return change?.files ?? [];
  }, [bookmark.payload, selectedJjChangeId]);

  const addChatPin = useCallback((pin: ChatPin) => {
    setChatPins((current) => {
      if (current.some((entry) => entry.id === pin.id)) return current;
      return [...current, pin];
    });
  }, []);

  const removeChatPin = useCallback((pinId: string) => {
    setChatPins((current) => current.filter((pin) => pin.id !== pinId));
  }, []);

  const clearChatPins = useCallback(() => {
    setChatPins([]);
  }, []);

  const beginComment = useCallback((pending: PendingDiffComment) => {
    setPendingComment(pending);
  }, []);

  const saveComment = useCallback((comment: DiffComment) => {
    setDiffComments((current) => {
      if (current.some((entry) => entry.id === comment.id)) return current;
      return [...current, comment];
    });
    setPendingComment(null);
  }, []);

  const cancelComment = useCallback(() => {
    setPendingComment(null);
  }, []);

  const deleteComment = useCallback((commentId: string) => {
    setDiffComments((current) =>
      current.filter((comment) => comment.id !== commentId),
    );
  }, []);

  const pinToChat = useCallback(
    (pin: ChatPin, message: string) => {
      addChatPin(pin);
      if (message.trim()) {
        setChatDraft(message.trim());
      }
      setPendingComment(null);
      setChatCollapsed(false);
    },
    [addChatPin],
  );

  const reportFileSelection = useCallback((paths: string[]) => {
    setSelectedFilePaths((current) =>
      pathsEqual(current, paths) ? current : paths,
    );
  }, []);

  const selectChange = useCallback(
    (jjChangeId: string | null) => {
      if (selectedJjChangeId === jjChangeId) return;
      setSelectedFilePaths([]);
      setChatPins([]);
      setPendingComment(null);
      setSelectedJjChangeId(jjChangeId);
    },
    [selectedJjChangeId],
  );

  const completeMoveToOwnChange = useCallback(
    (newJjChangeId?: string) => {
      setSelectedFilePaths([]);
      setChatPins([]);
      setPendingComment(null);
      setChatDraft("");

      if (!newJjChangeId) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("change", newJjChangeId);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const value = useMemo(
    (): PrReviewWorkspaceValue => ({
      bookmark,
      chatPins,
      diffComments,
      pendingComment,
      chatDraft,
      chatCollapsed,
      moveSelection,
      allowedMoveFiles,
      addChatPin,
      removeChatPin,
      clearChatPins,
      beginComment,
      saveComment,
      cancelComment,
      deleteComment,
      pinToChat,
      reportFileSelection,
      selectChange,
      completeMoveToOwnChange,
      updateChatDraft: setChatDraft,
      collapseChat: () => setChatCollapsed(true),
      expandChat: () => setChatCollapsed(false),
    }),
    [
      addChatPin,
      allowedMoveFiles,
      beginComment,
      bookmark,
      cancelComment,
      chatCollapsed,
      chatDraft,
      chatPins,
      clearChatPins,
      completeMoveToOwnChange,
      deleteComment,
      diffComments,
      moveSelection,
      pendingComment,
      pinToChat,
      removeChatPin,
      reportFileSelection,
      saveComment,
      selectChange,
    ],
  );

  return (
    <PrReviewWorkspaceContext.Provider value={value}>
      {children}
    </PrReviewWorkspaceContext.Provider>
  );
}

export function usePrReviewWorkspace() {
  const workspace = useContext(PrReviewWorkspaceContext);
  if (!workspace) {
    throw new Error(
      "usePrReviewWorkspace must be used inside PrReviewWorkspaceProvider",
    );
  }
  return workspace;
}
