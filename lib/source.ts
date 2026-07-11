import { docs } from "../.source";
import { loader } from "fumadocs-core/source";
import type { Source } from "fumadocs-core/source";

const docsSource = docs.toFumadocsSource();
const docsFiles = docsSource.files as unknown;
const normalizedDocsSource = {
  ...docsSource,
  files: typeof docsFiles === "function" ? docsFiles() : docsFiles
} as Source<{
  pageData: (typeof docs.docs)[number];
  metaData: (typeof docs.meta)[number];
}>;

export const source = loader({
  baseUrl: "/docs",
  source: normalizedDocsSource
});
