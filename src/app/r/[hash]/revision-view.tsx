"use client";

import { GitBranch, GitCommitHorizontal, Terminal } from "lucide-react";
import { useQuery } from "convex/react";
import { PatchDiff } from "@pierre/diffs/react";
import { api } from "../../../../convex/_generated/api";
import { SignInLink } from "@/components/sign-in-link";

export function RevisionView({ changeId }: { changeId: string }) {
  const revision = useQuery(api.gxRevisions.getByChangeId, { changeId });

  if (revision === undefined) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-6">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Loading revision…
        </p>
      </main>
    );
  }

  if (revision === null) {
    return <RevisionFallback changeId={changeId} />;
  }

  const [subject, ...rest] = revision.message.split("\n");
  const body = rest.join("\n").trim();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
          {revision.repoFullName ?? "revision"}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {subject || "(no description)"}
        </h1>
        {body ? (
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-neutral-600 dark:text-neutral-300">
            {body}
          </pre>
        ) : null}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500 dark:text-neutral-400">
          <div className="flex items-center gap-1.5">
            <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden />
            <dt className="sr-only">Revision id</dt>
            <dd className="font-mono">{revision.changeId}</dd>
          </div>
          {revision.commitId ? (
            <div className="flex items-center gap-1.5">
              <dt>commit</dt>
              <dd className="font-mono">{revision.commitId.slice(0, 12)}</dd>
            </div>
          ) : null}
          {revision.branchName ? (
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
              <dt className="sr-only">Branch</dt>
              <dd className="font-mono">
                {revision.branchName}
                {revision.baseBranchName
                  ? ` ← ${revision.baseBranchName}`
                  : null}
              </dd>
            </div>
          ) : null}
          {revision.pullRequestUrl ? (
            <div>
              <a
                className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                href={revision.pullRequestUrl}
                rel="noreferrer"
                target="_blank"
              >
                View pull request
              </a>
            </div>
          ) : null}
        </dl>
      </header>

      <section className="mt-8">
        {revision.patch ? (
          <PatchDiff patch={revision.patch} disableWorkerPool />
        ) : (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
            No diff was uploaded for this revision.
          </p>
        )}
      </section>

    </main>
  );
}

function RevisionFallback({ changeId }: { changeId: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 text-center">
      <Terminal
        className="h-8 w-8 text-neutral-400 dark:text-neutral-500"
        aria-hidden
      />
      <h1 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        This commit was made with GX
      </h1>
      <p className="mt-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">
        revision {changeId.slice(0, 16)}
      </p>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
        GX records the session context behind every revision — the task, the
        commands, the tests — and links it to the commit you are looking at.
        This revision is private or its context has not been uploaded.
      </p>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
        If you have access to this repository,{" "}
        <SignInLink className="underline underline-offset-2" /> with GitHub to
        view it.
      </p>
      <div className="mt-8 w-full rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-left font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        curl -fsSL https://download.gx.run/install.sh | sh
      </div>
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Install GX to record provenance for your own commits.
      </p>
    </main>
  );
}
