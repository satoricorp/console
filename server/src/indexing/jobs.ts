import { getSql } from "../db";
import { capture, Events } from "../telemetry/posthog";
import { runIncrementalIndex, type PushIndexInput } from "./turbopuffer";

export type EnqueueIndexReason = "push" | "install" | "manual";

export type EnqueueIndexInput = {
  orgId: string;
  repoFullName: string;
  reason: EnqueueIndexReason;
  ref?: string;
  afterSha?: string;
  commitMessages?: string[];
};

/** Async index job — does not block callers (e.g. PR Summary webhook). */
export function enqueueIndexJob(input: EnqueueIndexInput): void {
  capture(
    Events.IndexJob,
    {
      status: "enqueue",
      reason: input.reason,
      repo: input.repoFullName,
      ref: input.ref,
    },
    input.orgId,
  );

  setImmediate(() => {
    void runIndexJob(input).catch((error) => {
      console.error("index job failed", {
        orgId: input.orgId,
        repo: input.repoFullName,
        reason: input.reason,
        error,
      });
    });
  });
}

async function runIndexJob(input: EnqueueIndexInput): Promise<void> {
  const db = getSql();
  const payload: PushIndexInput = {
    orgId: input.orgId,
    repoFullName: input.repoFullName,
    reason: input.reason,
    ref: input.ref,
    afterSha: input.afterSha,
    commitMessages: input.commitMessages,
  };
  const result = await runIncrementalIndex(db, payload);
  if (result.status === "indexed") {
    console.info("index job completed", {
      orgId: input.orgId,
      repo: input.repoFullName,
      reason: input.reason,
      chunks: result.chunks,
    });
    capture(
      Events.IndexJob,
      {
        status: "complete",
        reason: input.reason,
        repo: input.repoFullName,
        chunks: result.chunks,
      },
      input.orgId,
    );
  } else if (result.status === "failed") {
    console.warn("index job failed", {
      orgId: input.orgId,
      repo: input.repoFullName,
      reason: input.reason,
      error: result.error,
    });
    capture(
      Events.IndexJob,
      {
        status: "fail",
        reason: input.reason,
        repo: input.repoFullName,
        error: result.error,
      },
      input.orgId,
    );
  }
}
