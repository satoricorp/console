export type JjOpType =
  | "relocate_change"
  | "restack"
  | "amend"
  | "squash"
  | "describe"
  | "rebase"
  | "split_to_change";

export type SplitLineRange = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
};

export type SplitToChangeOp = {
  type: "split_to_change";
  sourceChangeId: string;
  /** Disambiguates divergent jj change IDs (multiple commits per change). */
  sourceCommitId?: string;
  description: string;
  filePaths?: string[];
  lineRanges?: SplitLineRange[];
};

export type RelocateChangeOp = {
  type: "relocate_change";
  changeId: string;
  parentChangeId: string;
};

export type RestackOp = {
  type: "restack";
  changeIds?: string[];
};

export type AmendOp = {
  type: "amend";
  changeId: string;
  description?: string;
};

export type SquashOp = {
  type: "squash";
  sourceChangeId: string;
  targetChangeId: string;
};

export type DescribeOp = {
  type: "describe";
  changeId: string;
  description: string;
};

export type RebaseOp = {
  type: "rebase";
  ontoChangeId: string;
  changeIds: string[];
};

export type JjOp =
  | RelocateChangeOp
  | RestackOp
  | AmendOp
  | SquashOp
  | DescribeOp
  | RebaseOp
  | SplitToChangeOp;

export type ApplyRequest = {
  bookmarkId: string;
  userId: string;
  ops: JjOp[];
};

export type ApplyResult = {
  bookmarkId: string;
  revision: number;
  headCommitId: string;
  remoteHeadSha: string | null;
  newJjChangeId?: string | null;
  stackPayload?: Record<string, unknown> | null;
};
