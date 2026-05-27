export function namespaceForRepo(fullName: string) {
  return `repo-${fullName.replace("/", "-")}`;
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
]);

export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_FILES = 5000;
export const MAX_CHUNKS_PER_FILE = 20;
export const FILE_BATCH = 50;

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
