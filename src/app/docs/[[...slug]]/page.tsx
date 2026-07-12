import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { allDocSlugs, getDocPage } from "@/lib/docs-content";

type Props = {
  params: Promise<{ slug?: string[] }>;
};

export function generateStaticParams() {
  return allDocSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const page = getDocPage(params.slug ?? []);
  if (!page) return {};
  return {
    title: `${page.title} — GX Docs`,
    description: page.description,
  };
}

export default async function DocsPage(props: Props) {
  const params = await props.params;
  const page = getDocPage(params.slug ?? []);
  if (!page) notFound();

  return (
    <article className="docs-prose">
      <h1>{page.title}</h1>
      <p className="docs-description">{page.description}</p>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {page.content}
      </Markdown>
    </article>
  );
}
