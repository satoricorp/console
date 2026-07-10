import type { Metadata } from "next";
import { RevisionView } from "./revision-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const short = hash.slice(0, 12);
  return {
    title: `Revision ${short} — GX`,
    description:
      "A GX revision: the commit, its identity, and the recorded context behind it.",
  };
}

export default async function RevisionPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  return <RevisionView changeId={hash} />;
}
