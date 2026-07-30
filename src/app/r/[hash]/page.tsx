import type { Metadata } from "next";
import Link from "next/link";
import { GitCommitHorizontal } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const short = hash.slice(0, 12);
  return {
    title: `Revision ${short} — TX`,
    description:
      "A TX revision: the commit, its identity, and the recorded context behind it.",
  };
}

// Revision permalinks are stamped into commit trailers (`TX: https://gx.run/r/<id>`).
// The console does not render per-revision pages right now — review context
// surfaces in the PR Summary on the pull request — so this page just explains
// what the identifier is.
export default async function RevisionPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 text-center">
      <GitCommitHorizontal
        className="h-8 w-8 text-neutral-400 dark:text-neutral-500"
        aria-hidden
      />
      <h1 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        TX revision
      </h1>
      <p className="mt-2 font-mono text-sm text-neutral-500 dark:text-neutral-400">
        {hash}
      </p>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
        This identifier comes from a commit&apos;s <code>TX:</code> trailer. It links
        the commit to the coding session that produced it. The recorded context
        appears in the PR Summary on the pull request that includes this commit.
      </p>
      <div className="mt-6 flex items-center gap-4 text-sm">
        <Link
          href="/docs/how-it-works"
          className="text-neutral-900 underline underline-offset-4 dark:text-neutral-100"
        >
          How TX records revisions
        </Link>
        <Link
          href="/"
          className="text-neutral-500 underline underline-offset-4 dark:text-neutral-400"
        >
          gx.run
        </Link>
      </div>
    </main>
  );
}
