/**
 * The namespace holding one org's index of one repository.
 *
 * Identical to `namespaceForOrgRepo` in server/src/indexing/config.ts and
 * `NamespaceForRepo` in the gx CLI's internal/semantic/config.go. All three
 * write here and every reader looks here. The previous name, repo-{owner}-{repo},
 * had no org in it: two orgs sharing a repository shared one index and deleted
 * each other's rows, and the server's PR summaries never read it at all.
 */
export function namespaceForOrgRepo(orgId: string, fullName: string) {
  const slug = fullName
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  return `gx-${orgId}-${slug}-v2`;
}

export function parseFullName(fullName: string) {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return { owner, name };
}

export function documentId(
  fullName: string,
  commitId: string,
  filePath: string,
  chunkIndex: number,
) {
  const input = `${fullName}:${commitId}:${filePath}:${chunkIndex}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
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

export const SKIP_DIR_PREFIXES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "coverage/",
  "vendor/",
  ".turbo/",
  ".cache/",
];

export const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".vscdb",
  ".wasm",
  ".bin",
]);

/**
 * Binary sniff on UTF-8-decoded file content.
 *
 * The extension list cannot enumerate every binary shape a repository carries
 * — satoricorp/gx shipped a 12KB SQLite fixture as `.vscdb` — and binary is
 * the one content class that breaks the character-based chunk clamp: decoded
 * bytes tokenize near one token per character, so a 16000-character chunk
 * lands far past the embedding model's 8192-token limit and fails the whole
 * index run.
 *
 * NUL is decisive: it cannot appear in text a person wrote, and real binary
 * (SQLite, ELF, UTF-16 mistaken for UTF-8) is full of them. U+FFFD is the
 * replacement character `Buffer.toString("utf8")` substitutes for invalid
 * byte sequences; a few can appear in a mostly-text file with one bad byte,
 * so only a density past 2% of the sample counts as binary.
 */
export function isProbablyBinary(source: string): boolean {
  const sample = source.slice(0, 8192);
  if (sample.includes("\u0000")) return true;
  let replacements = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample.charCodeAt(i) === 0xfffd) replacements += 1;
  }
  return replacements > sample.length * 0.02;
}

export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_FILES = 5000;
export const MAX_CHUNKS_PER_FILE = 20;
/**
 * Files per action invocation.
 *
 * 50 was sized for the blob endpoint, where each file cost its own request and
 * a bigger batch meant more of them before the action's ten-minute ceiling.
 * With one tarball request per batch, fetching no longer scales with the batch
 * and the limit is embedding time, so a larger batch is strictly fewer GitHub
 * requests: 422 files went from 9 batches to 3.
 *
 * Not larger than this, because the batch is also the checkpoint interval — a
 * pass that dies redoes at most one batch.
 */
export const FILE_BATCH = 150;

const PRIORITY_PREFIXES = [
  "src/",
  "app/",
  "lib/",
  "packages/",
  "convex/",
  "services/",
];

export function indexPathPriority(path: string): number {
  const lower = path.toLowerCase();
  for (let i = 0; i < PRIORITY_PREFIXES.length; i++) {
    const prefix = PRIORITY_PREFIXES[i];
    if (lower.startsWith(prefix) || lower.includes(`/${prefix}`)) {
      return i;
    }
  }
  return PRIORITY_PREFIXES.length;
}

export function sortIndexableEntries<T extends { path: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    const priorityDiff = indexPathPriority(a.path) - indexPathPriority(b.path);
    if (priorityDiff !== 0) return priorityDiff;
    return a.path.localeCompare(b.path);
  });
}

export type DocType = "code_chunk" | "test_file" | "architecture_doc";

export function detectDocType(filePath: string): DocType {
  const lower = filePath.toLowerCase();
  if (
    lower.includes("__tests__/") ||
    lower.includes("/test/") ||
    /\.(test|spec)\.[jt]sx?$/.test(lower)
  ) {
    return "test_file";
  }
  if (
    lower === "readme.md" ||
    lower.startsWith("docs/") ||
    lower.endsWith(".md") ||
    lower.includes("/adr/")
  ) {
    return "architecture_doc";
  }
  return "code_chunk";
}

export function languageFromPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".swift": "swift",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
  };
  return map[ext] ?? "text";
}

export function shouldIndexPath(path: string, size?: number): boolean {
  if (SKIP_DIR_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  if (size !== undefined && size > MAX_FILE_BYTES) return false;
  return true;
}
