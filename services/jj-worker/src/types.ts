export type JjOpType =
  | "relocate_change"
  | "restack"
  | "amend"
  | "squash"
  | "describe"
  | "rebase";

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
  | RebaseOp;

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
};
