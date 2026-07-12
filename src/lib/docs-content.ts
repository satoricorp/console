import { readFileSync } from "node:fs";
import path from "node:path";

const DOCS_DIR = path.join(process.cwd(), "docs");

export type DocPage = {
  slug: string[];
  title: string;
  description: string;
  content: string;
};

export type DocNavEntry = {
  slug: string[];
  href: string;
  label: string;
};

type MetaFile = { title?: string; pages: string[] };

/** Sidebar labels that read better short than the page's frontmatter title. */
const NAV_LABEL_OVERRIDES: Record<string, string> = {
  github: "Pull Requests",
  "reference/api": "API",
};

function readMeta(dir: string): MetaFile {
  return JSON.parse(readFileSync(path.join(DOCS_DIR, dir, "meta.json"), "utf8")) as MetaFile;
}

function parseFrontmatter(raw: string): { title: string; description: string; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { title: "", description: "", content: raw };
  const fm = match[1];
  const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { title, description, content: raw.slice(match[0].length) };
}

/** Ordered list of page slugs from meta.json, recursing into sub-sections. */
function pageSlugs(): string[][] {
  const slugs: string[][] = [];
  for (const entry of readMeta(".").pages) {
    const nested = tryReadMeta(entry);
    if (nested) {
      for (const child of nested.pages) {
        slugs.push([entry, child]);
      }
      continue;
    }
    slugs.push(entry === "index" ? [] : [entry]);
  }
  return slugs;
}

function tryReadMeta(dir: string): MetaFile | null {
  try {
    return readMeta(dir);
  } catch {
    return null;
  }
}

export function getDocPage(slug: string[]): DocPage | null {
  const relative = slug.length === 0 ? "index" : slug.join("/");
  if (!/^[a-z0-9/-]+$/.test(relative) || relative.includes("..")) return null;
  let raw: string;
  try {
    raw = readFileSync(path.join(DOCS_DIR, `${relative}.mdx`), "utf8");
  } catch {
    return null;
  }
  const { title, description, content } = parseFrontmatter(raw);
  return { slug, title, description, content };
}

export function allDocSlugs(): string[][] {
  return pageSlugs();
}

export function docNav(): DocNavEntry[] {
  return pageSlugs().map((slug) => {
    const key = slug.join("/");
    const page = getDocPage(slug);
    return {
      slug,
      href: slug.length === 0 ? "/docs" : `/docs/${key}`,
      label: NAV_LABEL_OVERRIDES[key] ?? page?.title ?? key,
    };
  });
}

export function readDocsFile(name: "llms.txt" | "llms-full.txt"): string {
  return readFileSync(path.join(DOCS_DIR, name), "utf8");
}
