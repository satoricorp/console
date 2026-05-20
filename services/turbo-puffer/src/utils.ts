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
  return Bun.hash(input).toString(16).padStart(16, "0");
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
