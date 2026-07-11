import "server-only";

const CONSOLE_QUERY = "format=console";
const DEFAULT_GX_CLOUD_URL = "http://localhost:3201";

export function getGxApiBaseUrl(): string {
  return (process.env.GX_CLOUD_URL?.trim() || DEFAULT_GX_CLOUD_URL).replace(/\/+$/, "");
}

export function normalizeGxApiPath(path: string): string {
  const trimmed = path.trim();
  // Bookmark routes are registered without a /v1 prefix on the Hono server
  // (server/src/routes/bookmarks.ts), so paths pass through as given.
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function gxApiRequest(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const apiKey = process.env.GX_CLOUD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GX_CLOUD_API_KEY is not set");
  }

  const normalizedPath = normalizeGxApiPath(path);
  const separator = normalizedPath.includes("?") ? "&" : "?";
  const url = `${getGxApiBaseUrl()}${normalizedPath}${separator}${CONSOLE_QUERY}`;

  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${apiKey}`,
      "X-User-Id": userId,
    },
  });
}

export async function gxApiJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await gxApiRequest(userId, path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `GX API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
