import { clampToTokens, countTokens } from "./tokenClamp";
import {
  detectDocType,
  documentId,
  isProbablyBinary,
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
  startLine: number;
  endLine: number;
  chunkHash: string;
};

const CHUNK_LINES = 100;
/**
 * Byte ceiling on one chunk, independent of the line count.
 *
 * Lines are a poor proxy for size: a hundred lines of minified JavaScript or
 * embedded JSON is megabytes, and the embedding model rejects the request that
 * carries it. Kept below MAX_INPUT_CHARS in embedTextBatch so the text stored
 * in TurboPuffer is the text the vector was computed from — clamping only at
 * embed time would leave a row whose content the vector does not describe.
 */
const CHUNK_MAX_CHARS = 16000;
/**
 * Token ceiling on one chunk, measured with the embedding model's own
 * tokenizer.
 *
 * The character ceiling above assumes at least two characters per token, and
 * most source clears that. What doesn't: CJK prose (about one token per
 * character) and anything dense enough to defeat BPE. The API's hard limit is
 * 8192 per input; 7500 leaves margin. Clamping here rather than only at embed
 * time keeps the text stored in TurboPuffer the text the vector was computed
 * from.
 */
const CHUNK_MAX_TOKENS = 7500;
const OVERLAP_LINES = 15;
const MIN_SYMBOL_LINES = 6;

type SymbolBoundary = {
  lineIndex: number;
  symbol: string;
};

const RESERVED_WORDS = new Set([
  "catch",
  "else",
  "for",
  "if",
  "switch",
  "while",
  "with",
]);

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
  // A binary file that slipped past the extension filter embeds as garbage
  // and, worse, tokenizes past the embedding model's request limit — one such
  // file fails its whole batch and with it the entire index run. No chunks is
  // the correct index of a binary file.
  if (isProbablyBinary(source)) return chunks;

  const ranges = symbolRanges(lines, language);
  let chunkIndex = 0;

  for (const range of ranges) {
    const rangeLength = range.endLineIndex - range.startLineIndex + 1;
    if (rangeLength <= CHUNK_LINES) {
      chunks.push(
        buildChunk({
          fullName,
          commitId,
          filePath,
          docType,
          language,
          chunkIndex,
          startLineIndex: range.startLineIndex,
          endLineIndex: range.endLineIndex,
          symbol: range.symbol,
          lines,
        }),
      );
      chunkIndex += 1;
      continue;
    }

    let startLineIndex = range.startLineIndex;
    while (startLineIndex <= range.endLineIndex) {
      const endLineIndex = Math.min(
        startLineIndex + CHUNK_LINES - 1,
        range.endLineIndex,
      );
      chunks.push(
        buildChunk({
          fullName,
          commitId,
          filePath,
          docType,
          language,
          chunkIndex,
          startLineIndex,
          endLineIndex,
          symbol: range.symbol,
          lines,
        }),
      );
      chunkIndex += 1;
      if (endLineIndex >= range.endLineIndex) break;
      startLineIndex = endLineIndex - OVERLAP_LINES + 1;
    }
  }

  return chunks;
}

function symbolRanges(lines: string[], language: string) {
  const boundaries = detectSymbolBoundaries(lines, language);
  if (boundaries.length === 0) {
    return lineRanges(lines.length);
  }

  const ranges: Array<{
    startLineIndex: number;
    endLineIndex: number;
    symbol: string;
  }> = [];

  if (boundaries[0].lineIndex > 0) {
    ranges.push({
      startLineIndex: 0,
      endLineIndex: boundaries[0].lineIndex - 1,
      symbol: "",
    });
  }

  for (let i = 0; i < boundaries.length; i += 1) {
    const boundary = boundaries[i];
    const nextBoundary = boundaries[i + 1];
    const endLineIndex = (nextBoundary?.lineIndex ?? lines.length) - 1;
    if (endLineIndex < boundary.lineIndex) continue;

    const previous = ranges[ranges.length - 1];
    const rangeLength = endLineIndex - boundary.lineIndex + 1;
    if (
      previous &&
      previous.symbol === "" &&
      previous.endLineIndex + 1 === boundary.lineIndex &&
      rangeLength < MIN_SYMBOL_LINES
    ) {
      previous.endLineIndex = endLineIndex;
      previous.symbol = boundary.symbol;
      continue;
    }

    ranges.push({
      startLineIndex: boundary.lineIndex,
      endLineIndex,
      symbol: boundary.symbol,
    });
  }

  return ranges.flatMap((range) => {
    if (range.endLineIndex - range.startLineIndex + 1 <= CHUNK_LINES) {
      return [range];
    }
    return lineRanges(
      range.endLineIndex - range.startLineIndex + 1,
      range.startLineIndex,
      range.symbol,
    );
  });
}

function lineRanges(totalLines: number, offset = 0, symbol = "") {
  const ranges: Array<{
    startLineIndex: number;
    endLineIndex: number;
    symbol: string;
  }> = [];
  let start = 0;

  while (start < totalLines) {
    const end = Math.min(start + CHUNK_LINES, totalLines) - 1;
    ranges.push({
      startLineIndex: offset + start,
      endLineIndex: offset + end,
      symbol,
    });

    if (end + 1 >= totalLines) break;
    start = end + 1 - OVERLAP_LINES;
  }

  return ranges;
}

function detectSymbolBoundaries(
  lines: string[],
  language: string,
): SymbolBoundary[] {
  const boundaries: SymbolBoundary[] = [];

  lines.forEach((line, lineIndex) => {
    const symbol = detectSymbol(line, language);
    if (!symbol) return;
    boundaries.push({ lineIndex, symbol });
  });

  return boundaries.filter(
    (boundary, index) =>
      index === 0 || boundary.lineIndex !== boundaries[index - 1].lineIndex,
  );
}

function detectSymbol(line: string, language: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
    return null;
  }
  const isTopLevel = line === trimmed;

  const languageMatchers =
    language === "typescript" || language === "javascript"
      ? [
          /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
          /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
          /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
          /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
          ...(isTopLevel
            ? [
                /^(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/,
              ]
            : []),
        ]
      : language === "python"
        ? isTopLevel
          ? [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^class\s+([A-Za-z_]\w*)/]
          : []
        : language === "go"
          ? [/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)/]
          : language === "rust"
            ? [
                /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
                /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/,
              ]
            : [
                /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
                /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
                /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
                /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)/,
              ];

  for (const matcher of languageMatchers) {
    const match = trimmed.match(matcher);
    const symbol = match?.[1];
    if (symbol && !RESERVED_WORDS.has(symbol)) return symbol;
  }

  return null;
}

function buildChunk(args: {
  fullName: string;
  commitId: string;
  filePath: string;
  docType: DocType;
  language: string;
  chunkIndex: number;
  startLineIndex: number;
  endLineIndex: number;
  symbol: string;
  lines: string[];
}): SourceChunk {
  const startLine = args.startLineIndex + 1;
  const endLine = args.endLineIndex + 1;
  const body = args.lines
    .slice(args.startLineIndex, args.endLineIndex + 1)
    .join("\n");
  const header = [
    `repo: ${args.fullName}`,
    `file: ${args.filePath}`,
    `lines: ${startLine}-${endLine}`,
    args.symbol ? `symbol: ${args.symbol}` : "",
    `language: ${args.language}`,
    `doc_type: ${args.docType}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Clamp the body, not the header: the header carries the file path, symbol
  // and language a citation is built from, so truncating it would cost the
  // chunk its identity to save characters the model barely reads.
  const room = CHUNK_MAX_CHARS - header.length - 5;
  let clampedBody = body.length > room ? body.slice(0, Math.max(room, 0)) : body;

  // Characters first (cheap, bounds the encode below), then tokens (what the
  // embedding API actually enforces).
  const framing = `${header}\n---\n`;
  const bodyTokenBudget = CHUNK_MAX_TOKENS - countTokens(framing);
  clampedBody = clampToTokens(clampedBody, bodyTokenBudget);

  const content = `${framing}${clampedBody}`;

  return {
    id: documentId(args.fullName, args.commitId, args.filePath, args.chunkIndex),
    chunkIndex: args.chunkIndex,
    filePath: args.filePath,
    content,
    docType: args.docType,
    language: args.language,
    symbol: args.symbol,
    startLine,
    endLine,
    chunkHash: hashChunk(`${args.filePath}:${startLine}:${endLine}:${content}`),
  };
}

function hashChunk(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + 1;
    h2 = Math.imul(h2, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}
