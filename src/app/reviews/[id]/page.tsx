"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";

type StackEntry = {
  branch_name: string;
  base_branch_name: string;
  patch: string;
  github_pull_request_url?: string;
  change: {
    description: string;
    status: string;
    files: string[];
  };
};

type ReviewPayload = {
  change?: {
    description: string;
    status: string;
    files: string[];
  };
  stack?: StackEntry[];
  sessions?: { id: string; command: string }[];
};

type ReviewEvent = {
  id: string;
  created_at_ms: number;
  ingested_at: string;
  gx_version: string;
  remote_url: string | null;
  branch_name: string | null;
  head_commit_id: string;
  github_pr_url: string | null;
  payload: ReviewPayload;
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleString();
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const getReviewEvent = useAction(api.gxReviewActions.getReviewEvent);
  const [event, setEvent] = useState<ReviewEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user || !eventId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getReviewEvent({ eventId })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError("Review not found");
          setEvent(null);
          return;
        }
        setEvent(result as ReviewEvent);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load review",
        );
        setEvent(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, getReviewEvent, session?.user]);

  if (sessionPending) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-start gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to view this GX review.
        </p>
        <AuthButton />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">GX Review</h1>
        {event?.branch_name ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {event.branch_name}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-40 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {event ? (
        <>
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Commit</dt>
                <dd className="font-mono text-xs">{event.head_commit_id}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">GX version</dt>
                <dd>{event.gx_version}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Pushed</dt>
                <dd>{formatDate(event.created_at_ms)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Remote</dt>
                <dd className="break-all font-mono text-xs">
                  {event.remote_url ?? "—"}
                </dd>
              </div>
            </dl>
            {event.github_pr_url ? (
              <div className="mt-4">
                <Link
                  href={event.github_pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                >
                  Open GitHub pull request
                </Link>
              </div>
            ) : null}
          </section>

          {event.payload.change ? (
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Current change
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {event.payload.change.description}
              </p>
              <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
                {event.payload.change.status}
              </p>
              {event.payload.change.files.length > 0 ? (
                <ul className="mt-3 space-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {event.payload.change.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {event.payload.stack && event.payload.stack.length > 0 ? (
            <section className="space-y-4">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Stack ({event.payload.stack.length})
              </h2>
              {event.payload.stack.map((entry) => (
                <article
                  key={entry.branch_name}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm">{entry.branch_name}</p>
                      <p className="text-xs text-zinc-500">
                        base {entry.base_branch_name}
                      </p>
                    </div>
                    {entry.github_pull_request_url ? (
                      <Link
                        href={entry.github_pull_request_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                      >
                        PR
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {entry.change.description}
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Patch
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
                      {entry.patch}
                    </pre>
                  </details>
                </article>
              ))}
            </section>
          ) : null}

          {event.payload.sessions && event.payload.sessions.length > 0 ? (
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Linked sessions ({event.payload.sessions.length})
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                {event.payload.sessions.map((linkedSession) => (
                  <li key={linkedSession.id} className="font-mono text-xs">
                    {linkedSession.command}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {!loading && !error && !event ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Review not found.
        </p>
      ) : null}
    </main>
  );
}
