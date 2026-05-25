import {
  detectDocType,
  documentId,
  languageFromPath,
  type DocType,
} from "./utils";

export type SourceChunk = {
  id: string;
  chunkIndex: number;
  filePath: string;
  content: string;
  docType: DocType;
  language: string;
  symbol: string;
};

const CHUNK_LINES = 100;
const OVERLAP_LINES = 15;

export function chunkSourceFile(
  fullName: string,
  commitId: string,
  filePath: string,
  source: string,
): SourceChunk[] {
  const lines = source.split("\n");
  const docType = detectDocType(filePath);
  const language = languageFromPath(filePath);
  const chunks: SourceChunk[] = [];

  if (lines.length === 0) return chunks;

  let start = 0;
  let chunkIndex = 0;

  while (start < lines.length) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const slice = lines.slice(start, end);
    const body = slice.join("\n");
    const header = [
      `repo: ${fullName}`,
      `file: ${filePath}`,
      `language: ${language}`,
      `doc_type: ${docType}`,
    ].join("\n");

    chunks.push({
      id: documentId(fullName, commitId, filePath, chunkIndex),
      chunkIndex,
      filePath,
      content: `${header}\n---\n${body}`,
      docType,
      language,
      symbol: "",
    });

    if (end >= lines.length) break;
    start = end - OVERLAP_LINES;
    chunkIndex += 1;
  }

  return chunks;
}
